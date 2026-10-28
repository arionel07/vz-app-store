'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { GripVertical, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
	quizDraftInputSchema,
	type QuizAuthoringResponse,
	type StoreResponse,
	} from '@vizaje/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export type EditorOption = { label: string; isCorrect: boolean }
export type EditorQuestion = { prompt: string; options: EditorOption[] }
export type EditorDraft = {
	title: string
	description: string
	passingScore: number
	assignmentMode: 'all' | 'selected'
	storeIds: string[]
	questions: EditorQuestion[]
}

type QuizEditorProps = {
	initialQuiz: QuizAuthoringResponse | null
	stores: StoreResponse[]
	isAdmin: boolean
	onSave: (quizId: string | null, draft: EditorDraft) => Promise<QuizAuthoringResponse>
	onPublish: (quizId: string) => Promise<QuizAuthoringResponse>
	onClose: () => void
	onDirtyChange: (dirty: boolean) => void
}

function draftFromQuiz(quiz: QuizAuthoringResponse | null, isAdmin: boolean): EditorDraft {
	return {
		title: quiz?.title ?? '',
		description: quiz?.description ?? '',
		passingScore: quiz?.passingScore ?? 70,
		assignmentMode: quiz?.assignmentMode ?? (isAdmin ? 'all' : 'selected'),
		storeIds: quiz?.storeIds ?? [],
		questions: quiz?.questions.map((question) => ({
			prompt: question.prompt,
			options: question.options.map((option) => ({ label: option.label, isCorrect: option.isCorrect })),
		})) ?? [],
	}
}

function toPayload(draft: EditorDraft) {
	return {
		title: draft.title,
		description: draft.description.trim() || null,
		passingScore: draft.passingScore,
		assignmentMode: draft.assignmentMode,
		storeIds: draft.assignmentMode === 'all' ? [] : draft.storeIds,
		questions: draft.questions.map((question, position) => ({
			prompt: question.prompt,
			position,
			options: question.options.map((option, optionPosition) => ({ ...option, position: optionPosition })),
		})),
	}
}

function validationMessage(draft: EditorDraft, publish: boolean): string | null {
	const parsed = quizDraftInputSchema.safeParse(toPayload(draft))
	if (!parsed.success) return 'Проверьте название, проходной балл и назначение магазина'
	if (draft.questions.some((question) => question.options.length > 6)) return 'В вопросе может быть не более 6 вариантов ответа'
	if (!publish) return null
	if (draft.questions.length === 0) return 'Добавьте хотя бы один вопрос перед публикацией'
	if (draft.assignmentMode === 'selected' && draft.storeIds.length === 0) return 'Выберите хотя бы один активный магазин'
	if (draft.questions.some((question) => question.options.length < 2)) return 'У каждого вопроса должно быть от 2 до 6 вариантов ответа'
	if (draft.questions.some((question) => question.options.filter((option) => option.isCorrect).length !== 1)) return 'У каждого вопроса должен быть ровно один правильный ответ'
	return null
}

export function QuizEditor({ initialQuiz, stores, isAdmin, onSave, onPublish, onClose, onDirtyChange }: QuizEditorProps) {
	const [draft, setDraft] = useState<EditorDraft>(() => draftFromQuiz(initialQuiz, isAdmin))
	const [savedQuiz, setSavedQuiz] = useState<QuizAuthoringResponse | null>(initialQuiz)
	const [quizId, setQuizId] = useState<string | null>(initialQuiz?.id ?? null)
	const [dirty, setDirty] = useState(false)
	const [saving, setSaving] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)

	const activeStores = useMemo(() => stores.filter((store) => store.isActive), [stores])
	const isNewRevision = Boolean(initialQuiz && initialQuiz.revisionStatus !== 'draft')

	function changeDraft(next: EditorDraft) {
		setDraft(next)
		setDirty(true)
		onDirtyChange(true)
		setFormError(null)
	}

	function updateQuestion(index: number, update: Partial<EditorQuestion>) {
		changeDraft({ ...draft, questions: draft.questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...update } : question) })
	}

	function updateOption(questionIndex: number, optionIndex: number, update: Partial<EditorOption>) {
		changeDraft({
			...draft,
			questions: draft.questions.map((question, index) => index !== questionIndex ? question : {
				...question,
				options: question.options.map((option, index) => index === optionIndex ? { ...option, ...update } : update.isCorrect ? { ...option, isCorrect: false } : option),
			}),
		})
	}

	function addQuestion() {
		changeDraft({ ...draft, questions: [...draft.questions, { prompt: '', options: [{ label: '', isCorrect: true }, { label: '', isCorrect: false }] }] })
	}

	function removeQuestion(index: number) {
		changeDraft({ ...draft, questions: draft.questions.filter((_, questionIndex) => questionIndex !== index) })
	}

	function addOption(questionIndex: number) {
		changeDraft({ ...draft, questions: draft.questions.map((question, index) => index === questionIndex ? { ...question, options: [...question.options, { label: '', isCorrect: false }] } : question) })
	}

	function removeOption(questionIndex: number, optionIndex: number) {
		changeDraft({ ...draft, questions: draft.questions.map((question, index) => index === questionIndex ? { ...question, options: question.options.filter((_, currentIndex) => currentIndex !== optionIndex) } : question) })
	}

	function toggleStore(storeId: string) {
		changeDraft({ ...draft, storeIds: draft.storeIds.includes(storeId) ? draft.storeIds.filter((id) => id !== storeId) : [...draft.storeIds, storeId] })
	}

	async function persist(publishAfterSave: boolean) {
		const error = validationMessage(draft, publishAfterSave)
		if (error) {
			setFormError(error)
			return
		}
		if (publishAfterSave && !window.confirm('Опубликовать эту версию? После публикации вопросы и ответы этой версии нельзя изменить.')) return
		setSaving(true)
		setFormError(null)
		try {
			const saved = await onSave(quizId, draft)
			setQuizId(saved.id)
			setSavedQuiz(saved)
			setDraft(draftFromQuiz(saved, isAdmin))
			setDirty(false)
			onDirtyChange(false)
			if (publishAfterSave) {
				const published = await onPublish(saved.id)
				setSavedQuiz(published)
				setDraft(draftFromQuiz(published, isAdmin))
				toast.success('Квиз опубликован')
			} else {
				toast.success('Черновик сохранён')
			}
		} catch (error) {
			setFormError(error instanceof Error ? error.message : 'Не удалось сохранить квиз')
		} finally {
			setSaving(false)
		}
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		void persist(false)
	}

	function closeEditor() {
		if (dirty && !window.confirm('Есть несохранённые изменения. Закрыть редактор?')) return
		onClose()
	}

	return (
		<form className="quiz-editor" onSubmit={handleSubmit}>
			<div className="quiz-editor-header">
				<div>
					<p className="eyebrow">{quizId ? `Версия ${savedQuiz?.revisionNumber ?? initialQuiz?.revisionNumber ?? 1}` : 'Новый квиз'}</p>
					<h2 className="panel-title">{isNewRevision ? 'Новая версия квиза' : quizId ? 'Редактирование черновика' : 'Создание черновика'}</h2>
				</div>
				{savedQuiz && <Badge tone={savedQuiz.status === 'published' ? 'green' : savedQuiz.status === 'archived' ? 'danger' : 'blue'}>{savedQuiz.status === 'published' ? 'Опубликован' : savedQuiz.status === 'archived' ? 'В архиве' : 'Черновик'}</Badge>}
			</div>
			{isNewRevision && <div className="quiz-editor-notice">Опубликованная версия останется неизменной. Сохранение создаст новую черновую ревизию.</div>}
			<div className="quiz-editor-grid">
				<section className="quiz-editor-main">
					<div className="form-grid">
						<div className="form-field form-field-full"><label htmlFor="quiz-title">Название</label><Input id="quiz-title" value={draft.title} onChange={(event) => changeDraft({ ...draft, title: event.target.value })} autoFocus required /></div>
						<div className="form-field form-field-full"><label htmlFor="quiz-description">Описание <span className="field-hint">необязательно</span></label><Textarea id="quiz-description" value={draft.description} onChange={(event) => changeDraft({ ...draft, description: event.target.value })} rows={3} /></div>
						<div className="form-field"><label htmlFor="quiz-passing-score">Проходной балл, %</label><Input id="quiz-passing-score" type="number" min={0} max={100} value={draft.passingScore} onChange={(event) => changeDraft({ ...draft, passingScore: Number(event.target.value) })} required /></div>
						<div className="form-field"><label htmlFor="quiz-assignment-mode">Назначение</label><Select id="quiz-assignment-mode" value={draft.assignmentMode} onChange={(event) => changeDraft({ ...draft, assignmentMode: event.target.value as EditorDraft['assignmentMode'], storeIds: event.target.value === 'all' ? [] : draft.storeIds })}><option value="selected">Выбранные магазины</option>{isAdmin && <option value="all">Все магазины</option>}</Select></div>
					</div>
					<div className="quiz-section-heading"><div><p className="eyebrow">Вопросы</p><h3>{draft.questions.length} {draft.questions.length === 1 ? 'вопрос' : 'вопросов'}</h3></div><Button type="button" variant="outline" size="sm" onClick={addQuestion}><Plus size={14} />Добавить вопрос</Button></div>
					<div className="quiz-question-list">
						{draft.questions.length === 0 ? <div className="quiz-empty-inline">Добавьте первый вопрос. Черновик можно сохранить до заполнения.</div> : draft.questions.map((question, questionIndex) => <article className="quiz-question-card" key={questionIndex}><div className="quiz-question-card-header"><span className="quiz-question-number"><GripVertical size={14} />{questionIndex + 1}</span><button type="button" className="row-more" aria-label={`Удалить вопрос ${questionIndex + 1}`} onClick={() => removeQuestion(questionIndex)}><Trash2 size={15} /></button></div><div className="form-field"><label htmlFor={`quiz-question-${questionIndex}`}>Текст вопроса</label><Textarea id={`quiz-question-${questionIndex}`} value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} rows={2} required /></div><div className="quiz-options-heading"><span>Варианты ответа</span><small>Радиокнопка отмечает правильный ответ</small></div><div className="quiz-option-list">{question.options.map((option, optionIndex) => <div className="quiz-option-row" key={optionIndex}><input type="radio" name={`quiz-correct-${questionIndex}`} checked={option.isCorrect} onChange={() => updateOption(questionIndex, optionIndex, { isCorrect: true })} aria-label={`Правильный вариант ${optionIndex + 1}`} /><Input aria-label={`Вариант ${questionIndex + 1}.${optionIndex + 1}`} value={option.label} onChange={(event) => updateOption(questionIndex, optionIndex, { label: event.target.value })} placeholder={`Вариант ${optionIndex + 1}`} required={false} /><button type="button" className="row-more" disabled={question.options.length <= 2} aria-label={`Удалить вариант ${questionIndex + 1}.${optionIndex + 1}`} onClick={() => removeOption(questionIndex, optionIndex)}><Trash2 size={14} /></button></div>)}</div><Button type="button" variant="ghost" size="sm" disabled={question.options.length >= 6} onClick={() => addOption(questionIndex)}><Plus size={13} />Добавить вариант</Button></article>)}
					</div>
				</section>
				<aside className="quiz-editor-side">
					<div className="quiz-side-section"><div className="quiz-side-heading"><div><p className="eyebrow">Область доступа</p><h3>Магазины</h3></div><span>{draft.assignmentMode === 'all' ? 'Все' : draft.storeIds.length}</span></div>{draft.assignmentMode === 'all' ? <p className="role-note">Квиз будет доступен сотрудникам всех активных магазинов.</p> : <div className="store-checklist quiz-store-list">{activeStores.length ? activeStores.map((store) => <label className="store-check" key={store.id}><input type="checkbox" checked={draft.storeIds.includes(store.id)} onChange={() => toggleStore(store.id)} /><span>{store.name}</span><small className="ml-auto text-muted-foreground">{store.code}</small></label>) : <p className="role-note">Нет доступных активных магазинов.</p>}</div>}</div>
					<div className="quiz-side-section"><p className="eyebrow">Публикация</p><p className="role-note">После публикации ревизия становится неизменяемой. Новые изменения создадут следующую черновую ревизию.</p></div>
				</aside>
			</div>
			{formError && <div className="management-error quiz-form-error" role="alert">{formError}</div>}
			<div className="form-actions quiz-editor-actions"><Button type="button" variant="ghost" onClick={closeEditor} disabled={saving}>Отмена</Button><Button type="submit" variant="outline" disabled={saving}>{saving && <LoaderCircle size={14} className="animate-spin" />}Сохранить черновик</Button><Button type="button" onClick={() => void persist(true)} disabled={saving}>{saving && <LoaderCircle size={14} className="animate-spin" />}Сохранить и опубликовать</Button></div>
		</form>
	)
}

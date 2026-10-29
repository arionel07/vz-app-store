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

export type EditorOption = { label: string; isCorrect: boolean; points: number; explanation: string }
export type EditorTarget = { type: 'role'; role: 'staff' | 'manager' | 'admin' }
export type EditorQuestion = { prompt: string; description: string; type: 'single_choice' | 'multiple_choice' | 'weighted_choice' | 'free_text' | 'opinion' | 'rating' | 'scenario' | 'photo_answer'; maxPoints: number; scoringPolicy: 'all_or_nothing' | 'partial_credit'; config: Record<string, unknown>; options: EditorOption[] }
export type EditorDraft = {
	title: string
	description: string
	passingScore: number
	assignmentMode: 'all' | 'selected'
	storeIds: string[]
	questions: EditorQuestion[]
	assessmentMode: 'exam' | 'practice' | 'survey'
	maxAttempts: number | null
	timeLimitSeconds: number | null
	randomizeQuestions: boolean
	randomizeOptions: boolean
	showResults: boolean
	showExplanations: boolean
	assignmentTargets: EditorTarget[]
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
		assessmentMode: quiz?.assessmentMode ?? 'exam',
		maxAttempts: quiz?.maxAttempts ?? null,
		timeLimitSeconds: quiz?.timeLimitSeconds ?? null,
		randomizeQuestions: quiz?.randomizeQuestions ?? false,
		randomizeOptions: quiz?.randomizeOptions ?? false,
		showResults: quiz?.showResults ?? true,
		showExplanations: quiz?.showExplanations ?? false,
		assignmentTargets: quiz?.assignmentTargets?.filter((target): target is EditorTarget => target.type === 'role' && Boolean(target.role)).map((target) => ({ type: 'role', role: target.role! })) ?? [],
		questions: quiz?.questions.map((question) => ({
			prompt: question.prompt,
			description: question.description ?? '',
			type: question.type ?? 'single_choice',
			maxPoints: question.maxPoints ?? 1,
			scoringPolicy: question.scoringPolicy ?? 'all_or_nothing',
			config: question.config ?? {},
			options: question.options.map((option) => ({ label: option.label, isCorrect: Boolean(option.isCorrect), points: option.points ?? 0, explanation: option.explanation ?? '' })),
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
		assessmentMode: draft.assessmentMode,
		maxAttempts: draft.maxAttempts,
		timeLimitSeconds: draft.timeLimitSeconds,
		randomizeQuestions: draft.randomizeQuestions,
		randomizeOptions: draft.randomizeOptions,
		showResults: draft.showResults,
		showExplanations: draft.showExplanations,
		assignmentTargets: draft.assignmentTargets,
		questions: draft.questions.map((question, position) => ({
			prompt: question.prompt,
			description: question.description.trim() || null,
			position,
			type: question.type,
			maxPoints: question.maxPoints,
			scoringPolicy: question.scoringPolicy,
			config: question.config,
			options: question.options.map((option, optionPosition) => ({ ...option, explanation: option.explanation.trim() || null, position: optionPosition })),
		})),
	}
}

function validationMessage(draft: EditorDraft, publish: boolean): string | null {
	const parsed = quizDraftInputSchema.safeParse(toPayload(draft))
	if (!parsed.success) return 'Проверьте название, проходной балл и назначение магазина'
	if (draft.questions.some((question) => question.options.length > 6)) return 'В вопросе может быть не более 6 вариантов ответа'
	if (!publish) return null
	if (draft.questions.length === 0) return 'Добавьте хотя бы один вопрос перед публикацией'
	if (draft.assignmentMode === 'selected' && draft.storeIds.length === 0 && draft.assignmentTargets.length === 0) return 'Выберите магазин или роль для назначения'
	if (draft.questions.some((question) => ['single_choice', 'multiple_choice', 'weighted_choice', 'scenario', 'opinion'].includes(question.type) && (question.options.length < 2 || question.options.length > 6))) return 'У вопросов с вариантами должно быть от 2 до 6 вариантов ответа'
	if (draft.questions.some((question) => question.type === 'single_choice' && question.options.filter((option) => option.isCorrect).length !== 1)) return 'У каждого вопроса с одним ответом должен быть ровно один правильный вариант'
	if (draft.questions.some((question) => question.type === 'multiple_choice' && question.options.every((option) => !option.isCorrect))) return 'Укажите хотя бы один правильный вариант для множественного выбора'
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
				options: question.options.map((option, index) => index === optionIndex ? { ...option, ...update } : update.isCorrect && question.type !== 'multiple_choice' ? { ...option, isCorrect: false } : option),
			}),
		})
	}

	function addQuestion() {
		changeDraft({ ...draft, questions: [...draft.questions, { prompt: '', description: '', type: 'single_choice', maxPoints: 1, scoringPolicy: 'all_or_nothing', config: {}, options: [{ label: '', isCorrect: true, points: 1, explanation: '' }, { label: '', isCorrect: false, points: 0, explanation: '' }] }] })
	}

	function removeQuestion(index: number) {
		changeDraft({ ...draft, questions: draft.questions.filter((_, questionIndex) => questionIndex !== index) })
	}

	function addOption(questionIndex: number) {
		changeDraft({ ...draft, questions: draft.questions.map((question, index) => index === questionIndex ? { ...question, options: [...question.options, { label: '', isCorrect: false, points: 0, explanation: '' }] } : question) })
	}

	function removeOption(questionIndex: number, optionIndex: number) {
		changeDraft({ ...draft, questions: draft.questions.map((question, index) => index === questionIndex ? { ...question, options: question.options.filter((_, currentIndex) => currentIndex !== optionIndex) } : question) })
	}

	function toggleStore(storeId: string) {
		changeDraft({ ...draft, storeIds: draft.storeIds.includes(storeId) ? draft.storeIds.filter((id) => id !== storeId) : [...draft.storeIds, storeId] })
	}

	function toggleRole(role: EditorTarget['role']) {
		const exists = draft.assignmentTargets.some((target) => target.type === 'role' && target.role === role)
		changeDraft({ ...draft, assignmentTargets: exists ? draft.assignmentTargets.filter((target) => target.role !== role) : [...draft.assignmentTargets, { type: 'role', role }] })
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
						<div className="form-field"><label htmlFor="quiz-assessment-mode">Режим оценки</label><Select id="quiz-assessment-mode" value={draft.assessmentMode} onChange={(event) => changeDraft({ ...draft, assessmentMode: event.target.value as EditorDraft['assessmentMode'] })}><option value="exam">Экзамен</option><option value="practice">Практика</option><option value="survey">Опрос</option></Select></div>
						<div className="form-field"><label htmlFor="quiz-max-attempts">Лимит попыток</label><Input id="quiz-max-attempts" type="number" min={1} placeholder="Без лимита" value={draft.maxAttempts ?? ''} onChange={(event) => changeDraft({ ...draft, maxAttempts: event.target.value ? Number(event.target.value) : null })} /></div>
						<div className="form-field"><label htmlFor="quiz-time-limit">Лимит времени, минут</label><Input id="quiz-time-limit" type="number" min={1} placeholder="Без лимита" value={draft.timeLimitSeconds ? Math.ceil(draft.timeLimitSeconds / 60) : ''} onChange={(event) => changeDraft({ ...draft, timeLimitSeconds: event.target.value ? Number(event.target.value) * 60 : null })} /></div>
					</div>
					<div className="form-actions"><label className="store-check"><input type="checkbox" checked={draft.randomizeQuestions} onChange={(event) => changeDraft({ ...draft, randomizeQuestions: event.target.checked })} /><span>Перемешивать вопросы</span></label><label className="store-check"><input type="checkbox" checked={draft.randomizeOptions} onChange={(event) => changeDraft({ ...draft, randomizeOptions: event.target.checked })} /><span>Перемешивать варианты</span></label><label className="store-check"><input type="checkbox" checked={draft.showResults} onChange={(event) => changeDraft({ ...draft, showResults: event.target.checked })} /><span>Показывать результат</span></label><label className="store-check"><input type="checkbox" checked={draft.showExplanations} onChange={(event) => changeDraft({ ...draft, showExplanations: event.target.checked })} /><span>Показывать объяснения</span></label></div>
					<div className="quiz-section-heading"><div><p className="eyebrow">Вопросы</p><h3>{draft.questions.length} {draft.questions.length === 1 ? 'вопрос' : 'вопросов'}</h3></div><Button type="button" variant="outline" size="sm" onClick={addQuestion}><Plus size={14} />Добавить вопрос</Button></div>
					<div className="quiz-question-list">
						{draft.questions.length === 0 ? <div className="quiz-empty-inline">Добавьте первый вопрос. Черновик можно сохранить до заполнения.</div> : draft.questions.map((question, questionIndex) => {
							const hasOptions = ['single_choice', 'multiple_choice', 'weighted_choice', 'opinion', 'scenario'].includes(question.type)
							return <article className="quiz-question-card" key={questionIndex}><div className="quiz-question-card-header"><span className="quiz-question-number"><GripVertical size={14} />{questionIndex + 1}</span><button type="button" className="row-more" aria-label={`Удалить вопрос ${questionIndex + 1}`} onClick={() => removeQuestion(questionIndex)}><Trash2 size={15} /></button></div><div className="form-grid"><div className="form-field form-field-full"><label htmlFor={`quiz-question-${questionIndex}`}>Текст вопроса</label><Textarea id={`quiz-question-${questionIndex}`} value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} rows={2} required /></div><div className="form-field"><label htmlFor={`quiz-question-type-${questionIndex}`}>Тип вопроса</label><Select id={`quiz-question-type-${questionIndex}`} value={question.type} onChange={(event) => updateQuestion(questionIndex, { type: event.target.value as EditorQuestion['type'] })}><option value="single_choice">Один ответ</option><option value="multiple_choice">Несколько ответов</option><option value="weighted_choice">Взвешенный ответ</option><option value="scenario">Сценарий</option><option value="opinion">Мнение</option><option value="rating">Оценка</option><option value="free_text">Свободный текст</option><option value="photo_answer">Фото-ответ</option></Select></div><div className="form-field"><label htmlFor={`quiz-question-points-${questionIndex}`}>Максимум баллов</label><Input id={`quiz-question-points-${questionIndex}`} type="number" min={0} value={question.maxPoints} onChange={(event) => updateQuestion(questionIndex, { maxPoints: Number(event.target.value) })} /></div><div className="form-field"><label htmlFor={`quiz-question-policy-${questionIndex}`}>Скоринг</label><Select id={`quiz-question-policy-${questionIndex}`} value={question.scoringPolicy} onChange={(event) => updateQuestion(questionIndex, { scoringPolicy: event.target.value as EditorQuestion['scoringPolicy'] })}><option value="all_or_nothing">Всё или ничего</option><option value="partial_credit">Частичный балл</option></Select></div></div>{question.description !== undefined && <div className="form-field"><label htmlFor={`quiz-question-description-${questionIndex}`}>Подсказка</label><Input id={`quiz-question-description-${questionIndex}`} value={question.description} onChange={(event) => updateQuestion(questionIndex, { description: event.target.value })} /></div>}{hasOptions ? <><div className="quiz-options-heading"><span>Варианты ответа</span><small>{question.type === 'multiple_choice' ? 'Флажки отмечают правильные варианты' : 'Отметьте правильный вариант'}</small></div><div className="quiz-option-list">{question.options.map((option, optionIndex) => <div className="quiz-option-row" key={optionIndex}><input type={question.type === 'multiple_choice' ? 'checkbox' : 'radio'} name={`quiz-correct-${questionIndex}`} checked={option.isCorrect} onChange={(event) => updateOption(questionIndex, optionIndex, { isCorrect: event.target.checked })} aria-label={`Правильный вариант ${optionIndex + 1}`} /><Input aria-label={`Вариант ${questionIndex + 1}.${optionIndex + 1}`} value={option.label} onChange={(event) => updateOption(questionIndex, optionIndex, { label: event.target.value })} placeholder={`Вариант ${optionIndex + 1}`} required={false} />{question.type === 'weighted_choice' && <Input aria-label={`Баллы варианта ${questionIndex + 1}.${optionIndex + 1}`} type="number" min={0} value={option.points} onChange={(event) => updateOption(questionIndex, optionIndex, { points: Number(event.target.value) })} className="w-20" />}<button type="button" className="row-more" disabled={question.options.length <= 2} aria-label={`Удалить вариант ${questionIndex + 1}.${optionIndex + 1}`} onClick={() => removeOption(questionIndex, optionIndex)}><Trash2 size={14} /></button></div>)}</div><Button type="button" variant="ghost" size="sm" disabled={question.options.length >= 6} onClick={() => addOption(questionIndex)}><Plus size={13} />Добавить вариант</Button></> : <p className="role-note">Ответ будет сохранён для последующей обработки. Для фото-ответа сотрудник прикрепит фотографию в мобильном приложении.</p>}{question.type === 'rating' && <div className="form-grid"><div className="form-field"><label>Минимум</label><Input type="number" value={Number(question.config.minimum ?? 1)} onChange={(event) => updateQuestion(questionIndex, { config: { ...question.config, minimum: Number(event.target.value), scored: true } })} /></div><div className="form-field"><label>Максимум</label><Input type="number" value={Number(question.config.maximum ?? 5)} onChange={(event) => updateQuestion(questionIndex, { config: { ...question.config, maximum: Number(event.target.value), scored: true } })} /></div></div>}</article>
						})}
					</div>
				</section>
					<aside className="quiz-editor-side">
						<div className="quiz-side-section"><div className="quiz-side-heading"><div><p className="eyebrow">Область доступа</p><h3>Магазины</h3></div><span>{draft.assignmentMode === 'all' ? 'Все' : draft.storeIds.length}</span></div>{draft.assignmentMode === 'all' ? <p className="role-note">Квиз будет доступен сотрудникам всех активных магазинов.</p> : <div className="store-checklist quiz-store-list">{activeStores.length ? activeStores.map((store) => <label className="store-check" key={store.id}><input type="checkbox" checked={draft.storeIds.includes(store.id)} onChange={() => toggleStore(store.id)} /><span>{store.name}</span><small className="ml-auto text-muted-foreground">{store.code}</small></label>) : <p className="role-note">Нет доступных активных магазинов.</p>}</div>}</div>
						<div className="quiz-side-section"><div className="quiz-side-heading"><div><p className="eyebrow">Дополнительное назначение</p><h3>Роли</h3></div><span>{draft.assignmentTargets.length}</span></div><label className="store-check"><input type="checkbox" checked={draft.assignmentTargets.some((target) => target.role === 'staff')} onChange={() => toggleRole('staff')} /><span>Сотрудники</span></label>{isAdmin && <label className="store-check"><input type="checkbox" checked={draft.assignmentTargets.some((target) => target.role === 'manager')} onChange={() => toggleRole('manager')} /><span>Менеджеры</span></label>}<p className="role-note">Проверка области магазинов и роли выполняется API при публикации.</p></div>
					<div className="quiz-side-section"><p className="eyebrow">Публикация</p><p className="role-note">После публикации ревизия становится неизменяемой. Новые изменения создадут следующую черновую ревизию.</p></div>
				</aside>
			</div>
			{formError && <div className="management-error quiz-form-error" role="alert">{formError}</div>}
			<div className="form-actions quiz-editor-actions"><Button type="button" variant="ghost" onClick={closeEditor} disabled={saving}>Отмена</Button><Button type="submit" variant="outline" disabled={saving}>{saving && <LoaderCircle size={14} className="animate-spin" />}Сохранить черновик</Button><Button type="button" onClick={() => void persist(true)} disabled={saving}>{saving && <LoaderCircle size={14} className="animate-spin" />}Сохранить и опубликовать</Button></div>
		</form>
	)
}

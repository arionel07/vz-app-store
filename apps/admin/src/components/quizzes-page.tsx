'use client'

import { useCallback, useEffect, useState } from 'react'
import { Archive, ChevronLeft, ChevronRight, Edit3, Eye, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
	quizArchiveResponseSchema,
	quizAuthoringResponseSchema,
	quizDraftInputSchema,
	quizListResponseSchema,
	quizLifecycleSchema,
	storeListResponseSchema,
	type QuizAuthoringResponse,
	type StoreResponse,
	type QuizLifecycle,
} from '@vizaje/contracts'
import { QuizEditor, type EditorDraft } from '@/components/quiz-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useSessionUser } from '@/components/session-provider'
import { formatDate, ManagementError, managementFetch } from '@/lib/management-client'

const PAGE_SIZE = 15
const lifecycleLabels = { draft: 'Черновик', published: 'Опубликован', archived: 'Архив' } as const

function errorMessage(error: unknown): string {
	if (!(error instanceof ManagementError)) return 'Не удалось выполнить запрос'
	if (error.code === 'INVALID_QUIZ' || error.code === 'INVALID_QUIZ_ORDER' || error.code === 'INVALID_OPTION_ORDER' || error.code === 'INVALID_CORRECT_OPTION') return 'Проверьте вопросы, варианты ответа и порядок элементов'
	if (error.code === 'INVALID_ASSIGNMENT' || error.code === 'STORE_UNAVAILABLE') return 'Проверьте назначение на активные магазины'
	if (error.code === 'NO_DRAFT_REVISION') return 'У квиза нет черновой ревизии для публикации'
	if (error.status === 403) return 'У вас нет прав для этой операции'
	if (error.status === 401) return 'Сеанс завершён. Выполните вход снова'
	if (error.status >= 500) return 'Сервис управления временно недоступен'
	return 'Не удалось выполнить запрос'
}

function toPayload(draft: EditorDraft) {
	return quizDraftInputSchema.parse({
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
	})
}

export function QuizzesPage() {
	const user = useSessionUser()
	const isAdmin = user.role === 'admin'
	const [quizzes, setQuizzes] = useState<QuizAuthoringResponse[]>([])
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [selected, setSelected] = useState<QuizAuthoringResponse | null>(null)
	const [search, setSearch] = useState('')
	const [status, setStatus] = useState<'all' | QuizLifecycle>('all')
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [editorQuiz, setEditorQuiz] = useState<QuizAuthoringResponse | null>(null)
	const [editorOpen, setEditorOpen] = useState(false)
	const [editorDirty, setEditorDirty] = useState(false)
	const [archiveId, setArchiveId] = useState<string | null>(null)

	const loadStores = useCallback(async () => {
		try {
			const response = await managementFetch('/api/admin/stores?page=1&pageSize=100&isActive=true&sortBy=name&sortDirection=asc', storeListResponseSchema)
			setStores(response.data)
		} catch (requestError) {
			if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login')
		}
	}, [])

	const loadQuizzes = useCallback(async () => {
		setLoading(true)
		setError(null)
		const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
		if (search.trim()) params.set('search', search.trim())
		if (status !== 'all') params.set('status', status)
		try {
			const response = await managementFetch(`/api/admin/quizzes?${params}`, quizListResponseSchema)
			setQuizzes(response.data)
			setPagination(response.pagination)
			setSelected((current) => current ? response.data.find((quiz) => quiz.id === current.id) ?? null : response.data[0] ?? null)
		} catch (requestError) {
			if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login')
			else setError(errorMessage(requestError))
		} finally {
			setLoading(false)
		}
	}, [page, search, status])

	useEffect(() => { void loadStores() }, [loadStores])
	useEffect(() => { void loadQuizzes() }, [loadQuizzes])

	async function selectQuiz(quiz: QuizAuthoringResponse) {
		setSelected(quiz)
		try {
			setSelected(await managementFetch(`/api/admin/quizzes/${quiz.id}`, quizAuthoringResponseSchema))
		} catch (requestError) {
			toast.error(errorMessage(requestError))
		}
	}

	function openEditor(quiz: QuizAuthoringResponse | null) {
		setEditorQuiz(quiz)
		setEditorOpen(true)
	}

	function closeEditor() {
		setEditorOpen(false)
		setEditorQuiz(null)
		setEditorDirty(false)
	}

	function requestEditorClose() {
		if (editorDirty && !window.confirm('Есть несохранённые изменения. Закрыть редактор?')) return
		closeEditor()
	}

	async function saveQuiz(quizId: string | null, draft: EditorDraft): Promise<QuizAuthoringResponse> {
		try {
			const payload = toPayload(draft)
			const response = await managementFetch(quizId ? `/api/admin/quizzes/${quizId}/draft` : '/api/admin/quizzes', quizAuthoringResponseSchema, {
				method: quizId ? 'PUT' : 'POST',
				body: JSON.stringify(payload),
			})
			setSelected(response)
			await loadQuizzes()
			return response
		} catch (requestError) {
			throw new Error(errorMessage(requestError))
		}
	}

	async function publishQuiz(quizId: string): Promise<QuizAuthoringResponse> {
		try {
			const response = await managementFetch(`/api/admin/quizzes/${quizId}/publish`, quizAuthoringResponseSchema, { method: 'POST' })
			setSelected(response)
			await loadQuizzes()
			return response
		} catch (requestError) {
			throw new Error(errorMessage(requestError))
		}
	}

	async function archiveQuiz() {
		if (!selected || archiveId) return
		if (!window.confirm('Переместить квиз в архив? Новые попытки по нему будут недоступны, исторические результаты сохранятся.')) return
		setArchiveId(selected.id)
		try {
			await managementFetch(`/api/admin/quizzes/${selected.id}/archive`, quizArchiveResponseSchema, { method: 'POST' })
			toast.success('Квиз перемещён в архив')
			setSelected(null)
			await loadQuizzes()
		} catch (requestError) {
			toast.error(errorMessage(requestError))
		} finally {
			setArchiveId(null)
		}
	}

	const selectedStoreNames = selected?.storeIds.map((id) => stores.find((store) => store.id === id)?.name ?? 'Недоступный магазин') ?? []

	return (
		<div className="management-page">
			<header className="management-toolbar"><div><p className="eyebrow">Рабочая область</p><h1 className="page-title">Квизы</h1><p className="page-subtitle">Версии, публикация и назначение обучения из API</p></div><div className="management-toolbar-actions"><Button variant="outline" size="sm" onClick={() => void loadQuizzes()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Обновить</Button><Button size="sm" onClick={() => openEditor(null)}><Plus size={14} />Создать черновик</Button></div></header>
			<div className="management-filters"><label className="sr-only" htmlFor="quiz-search">Поиск квизов</label><div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input id="quiz-search" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value) }} placeholder="Поиск по названию" className="pl-9" /></div><label className="sr-only" htmlFor="quiz-status">Статус квиза</label><Select id="quiz-status" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as 'all' | QuizLifecycle) }}><option value="all">Все статусы</option><option value="draft">Черновики</option><option value="published">Опубликованные</option><option value="archived">Архив</option></Select><div className="flex items-center justify-end text-xs text-muted-foreground">{isAdmin ? 'Полный доступ администратора' : 'Квизы вашей области магазинов'}</div></div>
			{error && <div className="management-error" role="alert">{error}<button type="button" onClick={() => void loadQuizzes()}>Повторить</button></div>}
			<div className="management-grid mt-3"><section className="management-surface" aria-label="Список квизов">{loading ? <div className="management-state"><div><LoaderCircle className="mx-auto animate-spin text-muted-foreground" /><p>Загружаем квизы…</p></div></div> : quizzes.length === 0 ? <div className="management-state"><div><Eye className="mx-auto text-muted-foreground" /><strong>Квизы не найдены</strong><p>Измените фильтры или создайте первый черновик.</p></div></div> : <><table className="management-table"><thead><tr><th>Квиз</th><th>Ревизия</th><th>Назначение</th><th>Вопросы</th><th>Изменён</th><th>Статус</th><th aria-label="Действия" /></tr></thead><tbody>{quizzes.map((quiz) => <tr key={quiz.id} aria-selected={selected?.id === quiz.id} onClick={() => void selectQuiz(quiz)}><td><div className="employee-name-cell"><span className="quiz-row-mark">{quiz.revisionNumber}</span><div><strong>{quiz.title}</strong><small>{quiz.description || 'Без описания'}</small></div></div></td><td>v{quiz.revisionNumber}</td><td>{quiz.assignmentMode === 'all' ? 'Все магазины' : `${quiz.storeIds.length} магаз.`}</td><td>{quiz.questions.length}</td><td className="cell-muted">{formatDate(quiz.updatedAt)}</td><td><Badge tone={quiz.status === 'published' ? 'green' : quiz.status === 'archived' ? 'danger' : 'blue'}>{lifecycleLabels[quiz.status]}</Badge></td><td className="actions-cell"><button type="button" className="row-more" aria-label={`${quiz.status === 'draft' ? 'Редактировать' : 'Создать новую версию'} ${quiz.title}`} onClick={(event) => { event.stopPropagation(); openEditor(quiz) }}><Edit3 size={15} /></button></td></tr>)}</tbody></table><div className="management-pagination"><span>{pagination.total === 0 ? 'Нет квизов' : `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} из ${pagination.total}`}</span><div className="management-pagination-actions"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /></button><span>{page} / {Math.max(pagination.totalPages, 1)}</span><button type="button" aria-label="Следующая страница" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight size={15} /></button></div></div></>}</section><aside className="management-surface management-inspector" aria-label="Карточка квиза">{!selected ? <div className="management-state"><div><Eye className="mx-auto text-muted-foreground" /><p>Выберите квиз, чтобы увидеть детали.</p></div></div> : <><div className="panel-header"><div><p className="eyebrow">Карточка</p><h2 className="panel-title">{selected.title}</h2><p className="panel-description">Версия {selected.revisionNumber} · {lifecycleLabels[selected.status]}</p></div><Button variant="ghost" size="icon-sm" aria-label="Открыть редактор" onClick={() => openEditor(selected)}><Edit3 /></Button></div><div className="panel-content"><dl className="management-meta"><div><dt>Описание</dt><dd>{selected.description || '—'}</dd></div><div><dt>Проходной балл</dt><dd>{selected.passingScore}%</dd></div><div><dt>Магазины</dt><dd>{selected.assignmentMode === 'all' ? 'Все магазины' : selectedStoreNames.length ? selectedStoreNames.join(', ') : 'Не назначены'}</dd></div><div><dt>Вопросы</dt><dd>{selected.questions.length}</dd></div><div><dt>Обновлён</dt><dd>{formatDate(selected.updatedAt)}</dd></div></dl><div className="management-actions"><Button variant="outline" size="sm" onClick={() => openEditor(selected)}><Edit3 size={14} />{selected.status === 'draft' ? 'Редактировать' : 'Новая версия'}</Button>{selected.status === 'draft' && <Button size="sm" onClick={() => openEditor(selected)}>Опубликовать через редактор</Button>}{selected.status !== 'archived' && <Button variant="destructive" size="sm" disabled={archiveId === selected.id} onClick={() => void archiveQuiz()}>{archiveId === selected.id && <LoaderCircle size={14} className="animate-spin" />}<Archive size={14} />Архивировать</Button>}</div><div className="quiz-preview"><p className="eyebrow">Вопросы ревизии</p>{selected.questions.slice(0, 4).map((question, index) => <div className="quiz-preview-row" key={question.id}><span>{index + 1}</span><strong>{question.prompt}</strong><small>{question.options.length} варианта</small></div>)}{selected.questions.length > 4 && <p className="role-note">И ещё {selected.questions.length - 4} вопросов.</p>}</div></div></>}</aside></div>
			<Dialog open={editorOpen} onClose={requestEditorClose} title={editorQuiz ? (editorQuiz.status === 'draft' ? 'Редактор черновика' : 'Новая версия квиза') : 'Новый квиз'} className="quiz-editor-dialog"><QuizEditor key={`${editorQuiz?.id ?? 'new'}-${editorQuiz?.revisionId ?? 'new'}`} initialQuiz={editorQuiz} stores={stores} isAdmin={isAdmin} onSave={saveQuiz} onPublish={publishQuiz} onClose={closeEditor} onDirtyChange={setEditorDirty} /></Dialog>
		</div>
	)
}

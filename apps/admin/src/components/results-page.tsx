'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ClipboardCheck, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
	quizListResponseSchema,
	resultListResponseSchema,
	userListResponseSchema,
	type QuizAuthoringResponse,
	type ResultResponse,
	type UserResponse,
} from '@vizaje/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDate, ManagementError, managementFetch } from '@/lib/management-client'

const PAGE_SIZE = 15

function errorMessage(error: unknown): string {
	if (!(error instanceof ManagementError)) return 'Не удалось выполнить запрос'
	if (error.status === 403) return 'У вас нет прав для просмотра результатов'
	if (error.status === 401) return 'Сеанс завершён. Выполните вход снова'
	if (error.status >= 500) return 'Сервис результатов временно недоступен'
	return 'Не удалось выполнить запрос'
}

export function ResultsPage() {
	const [quizOptions, setQuizOptions] = useState<QuizAuthoringResponse[]>([])
	const [employees, setEmployees] = useState<UserResponse[]>([])
	const [selectedQuizId, setSelectedQuizId] = useState('')
	const [selectedUserId, setSelectedUserId] = useState('')
	const [status, setStatus] = useState<'submitted' | 'in_progress' | 'all'>('submitted')
	const [search, setSearch] = useState('')
	const [results, setResults] = useState<ResultResponse[]>([])
	const [selected, setSelected] = useState<ResultResponse | null>(null)
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [loadingFilters, setLoadingFilters] = useState(true)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const quizById = useMemo(() => new Map(quizOptions.map((quiz) => [quiz.id, quiz])), [quizOptions])
	const selectedQuiz = selectedQuizId ? quizById.get(selectedQuizId) : undefined
	const filteredResults = useMemo(() => {
		const normalized = search.trim().toLowerCase()
		if (!normalized) return results
		return results.filter((result) => result.userName.toLowerCase().includes(normalized))
	}, [results, search])

	const loadFilters = useCallback(async () => {
		setLoadingFilters(true)
		try {
			const [quizList, userList] = await Promise.all([
				managementFetch('/api/admin/quizzes?page=1&pageSize=100', quizListResponseSchema),
				managementFetch('/api/admin/employees?page=1&pageSize=100&sortBy=lastName&sortDirection=asc', userListResponseSchema),
			])
			setQuizOptions(quizList.data)
			setEmployees(userList.data)
			setSelectedQuizId((current) => current || quizList.data[0]?.id || '')
		} catch (requestError) {
			if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login')
			else setError(errorMessage(requestError))
		} finally {
			setLoadingFilters(false)
		}
	}, [])

	const loadResults = useCallback(async () => {
		if (!selectedQuizId) {
			setResults([])
			setPagination({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
			return
		}
		setLoading(true)
		setError(null)
		const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
		if (selectedUserId) params.set('userId', selectedUserId)
		if (status !== 'all') params.set('status', status)
		try {
			const response = await managementFetch(`/api/admin/quizzes/${selectedQuizId}/results?${params}`, resultListResponseSchema)
			setResults(response.data)
			setPagination(response.pagination)
			setSelected((current) => current ? response.data.find((result) => result.attemptId === current.attemptId) ?? null : response.data[0] ?? null)
		} catch (requestError) {
			if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login')
			else setError(errorMessage(requestError))
		} finally {
			setLoading(false)
		}
	}, [page, selectedQuizId, selectedUserId, status])

	useEffect(() => { void loadFilters() }, [loadFilters])
	useEffect(() => { void loadResults() }, [loadResults])

	function changeFilter(change: () => void) {
		setPage(1)
		setSelected(null)
		change()
	}

	return (
		<div className="management-page">
			<header className="management-toolbar"><div><p className="eyebrow">Рабочая область</p><h1 className="page-title">Результаты</h1><p className="page-subtitle">Завершённые попытки с сохранением исторических ревизий</p></div><div className="management-toolbar-actions"><Button variant="outline" size="sm" onClick={() => void Promise.all([loadFilters(), loadResults()])} disabled={loading || loadingFilters}><RefreshCw size={14} className={loading || loadingFilters ? 'animate-spin' : ''} />Обновить</Button></div></header>
			<div className="management-filters results-filters"><label className="sr-only" htmlFor="results-quiz">Квиз</label><Select id="results-quiz" value={selectedQuizId} disabled={loadingFilters} onChange={(event) => changeFilter(() => setSelectedQuizId(event.target.value))}><option value="">Выберите квиз</option>{quizOptions.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.title} · v{quiz.revisionNumber}</option>)}</Select><label className="sr-only" htmlFor="results-user">Сотрудник</label><Select id="results-user" value={selectedUserId} onChange={(event) => changeFilter(() => setSelectedUserId(event.target.value))}><option value="">Все сотрудники</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</Select><label className="sr-only" htmlFor="results-status">Статус попытки</label><Select id="results-status" value={status} onChange={(event) => changeFilter(() => setStatus(event.target.value as 'submitted' | 'in_progress' | 'all'))}><option value="submitted">Завершённые</option><option value="in_progress">В процессе</option><option value="all">Все попытки</option></Select><div className="relative results-search"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input id="results-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск сотрудника" className="pl-9" /></div></div>
			{error && <div className="management-error" role="alert">{error}<button type="button" onClick={() => void loadResults()}>Повторить</button></div>}
			{!loadingFilters && quizOptions.length === 0 ? <div className="management-surface management-state mt-3"><div><ClipboardCheck className="mx-auto text-muted-foreground" /><strong>Результатов пока нет</strong><p>Сначала создайте и опубликуйте квиз, затем сотрудники смогут пройти его.</p></div></div> : <div className="management-grid mt-3"><section className="management-surface" aria-label="Список результатов">{loading || loadingFilters ? <div className="management-state"><div><LoaderCircle className="mx-auto animate-spin text-muted-foreground" /><p>Загружаем результаты…</p></div></div> : filteredResults.length === 0 ? <div className="management-state"><div><ClipboardCheck className="mx-auto text-muted-foreground" /><strong>Результаты не найдены</strong><p>Измените фильтры или дождитесь завершённых попыток.</p></div></div> : <><table className="management-table"><thead><tr><th>Сотрудник</th><th>Квиз</th><th>Ревизия</th><th>Балл</th><th>Итог</th><th>Отправлено</th></tr></thead><tbody>{filteredResults.map((result) => <tr key={result.attemptId} aria-selected={selected?.attemptId === result.attemptId} onClick={() => setSelected(result)}><td><strong>{result.userName}</strong><small className="result-id">{result.attemptId}</small></td><td>{selectedQuiz?.title ?? 'Квиз'}</td><td>v{result.revisionNumber}</td><td>{result.scorePercent === null ? '—' : `${result.scorePercent}%`}</td><td><Badge tone={result.status !== 'submitted' ? 'blue' : result.passed ? 'green' : 'danger'}>{result.status !== 'submitted' ? 'В процессе' : result.passed ? 'Пройден' : 'Не пройден'}</Badge></td><td className="cell-muted">{result.submittedAt ? formatDate(result.submittedAt) : 'Не отправлено'}</td></tr>)}</tbody></table><div className="management-pagination"><span>{pagination.total === 0 ? 'Нет попыток' : `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} из ${pagination.total}`}</span><div className="management-pagination-actions"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /></button><span>{page} / {Math.max(pagination.totalPages, 1)}</span><button type="button" aria-label="Следующая страница" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight size={15} /></button></div></div></>}</section><aside className="management-surface management-inspector" aria-label="Детали результата">{!selected ? <div className="management-state"><div><ClipboardCheck className="mx-auto text-muted-foreground" /><p>Выберите результат, чтобы увидеть детали попытки.</p></div></div> : <><div className="panel-header"><div><p className="eyebrow">Попытка</p><h2 className="panel-title">{selected.userName}</h2><p className="panel-description">{selectedQuiz?.title ?? 'Квиз'} · версия {selected.revisionNumber}</p></div><Badge tone={selected.passed ? 'green' : selected.status === 'submitted' ? 'danger' : 'blue'}>{selected.status === 'submitted' ? (selected.passed ? 'Пройден' : 'Не пройден') : 'В процессе'}</Badge></div><div className="panel-content"><dl className="management-meta"><div><dt>Балл</dt><dd>{selected.scorePercent === null ? '—' : `${selected.scorePercent}%`}</dd></div><div><dt>Начало</dt><dd>{formatDate(selected.startedAt)}</dd></div><div><dt>Отправлено</dt><dd>{selected.submittedAt ? formatDate(selected.submittedAt) : 'Не отправлено'}</dd></div><div><dt>Идентификатор</dt><dd className="max-w-[180px] truncate">{selected.attemptId}</dd></div></dl><p className="role-note">Ответы и правильные варианты не передаются в management results API. Историческая ревизия результата сохраняется отдельно.</p></div></>}</aside></div>}
		</div>
	)
}

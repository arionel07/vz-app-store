'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, CalendarDays, Image as ImageIcon, LoaderCircle, RefreshCw, Store as StoreIcon, UsersRound } from 'lucide-react'
import { dashboardOverviewResponseSchema, dashboardPhotosResponseSchema, dashboardQuizzesResponseSchema, storeListResponseSchema, type DashboardOverviewResponse, type DashboardPhotosResponse, type DashboardQuizzesResponse, type StoreResponse } from '@vizaje/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatDateOnly, ManagementError, managementFetch } from '@/lib/management-client'

function dateInputValue(date: Date): string { return date.toISOString().slice(0, 10) }
function defaultRange(): { start: string; end: string } { const end = new Date(); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 29); return { start: dateInputValue(start), end: dateInputValue(end) } }
function utcRange(start: string, end: string): { startDate: string; endDate: string } { const endExclusive = new Date(`${end}T00:00:00.000Z`); endExclusive.setUTCDate(endExclusive.getUTCDate() + 1); return { startDate: new Date(`${start}T00:00:00.000Z`).toISOString(), endDate: endExclusive.toISOString() } }
function errorMessage(error: unknown): string { if (!(error instanceof ManagementError)) return 'Не удалось загрузить аналитику'; if (error.status === 401) return 'Сеанс завершён. Выполните вход снова'; if (error.status === 403) return 'У вас нет доступа к аналитике'; if (error.status >= 500) return 'Сервис аналитики временно недоступен'; return error.message || 'Не удалось загрузить аналитику' }
function nullablePercent(value: number | null): string { return value === null ? '—' : `${value.toLocaleString('ru-RU')}%` }

export function DashboardPage() {
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [storeId, setStoreId] = useState('')
	const [range, setRange] = useState(defaultRange)
	const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null)
	const [photos, setPhotos] = useState<DashboardPhotosResponse | null>(null)
	const [quizzes, setQuizzes] = useState<DashboardQuizzesResponse | null>(null)
	const [loadingStores, setLoadingStores] = useState(true)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		managementFetch('/api/admin/stores?page=1&pageSize=100&isActive=true&sortBy=name&sortDirection=asc', storeListResponseSchema).then((response) => { if (!cancelled) setStores(response.data) }).catch((reason) => { if (!cancelled) setError(errorMessage(reason)) }).finally(() => { if (!cancelled) setLoadingStores(false) })
		return () => { cancelled = true }
	}, [])

	const loadDashboard = useCallback(async () => {
		if (!range.start || !range.end || range.start > range.end) { setError('Проверьте диапазон дат'); return }
		setLoading(true); setError(null)
		const params = new URLSearchParams(utcRange(range.start, range.end)); if (storeId) params.set('storeId', storeId)
		const quizParams = new URLSearchParams(params); quizParams.set('page', '1'); quizParams.set('pageSize', '100')
		try {
			const [overviewResponse, photoResponse, quizResponse] = await Promise.all([
				managementFetch(`/api/admin/dashboard/overview?${params}`, dashboardOverviewResponseSchema),
				managementFetch(`/api/admin/dashboard/photos?${params}`, dashboardPhotosResponseSchema),
				managementFetch(`/api/admin/dashboard/quizzes?${quizParams}`, dashboardQuizzesResponseSchema),
			])
			setOverview(overviewResponse); setPhotos(photoResponse); setQuizzes(quizResponse)
		} catch (reason) { setOverview(null); setPhotos(null); setQuizzes(null); setError(errorMessage(reason)) } finally { setLoading(false) }
	}, [range.end, range.start, storeId])
	useEffect(() => { void loadDashboard() }, [loadDashboard])

	const maxDaily = useMemo(() => Math.max(...(photos?.dailyUploads.map((item) => item.count) ?? [0]), 1), [photos])
	const selectedStoreName = stores.find((store) => store.id === storeId)?.name
	const periodLabel = overview ? `${formatDateOnly(overview.period.start)} — ${formatDateOnly(overview.period.end)}` : `${range.start} — ${range.end}`

	return <div className="management-page">
		<header className="page-header"><div><h1 className="page-title">Обзор</h1><p className="page-subtitle">Реальная аналитика за период в UTC{selectedStoreName ? ` · ${selectedStoreName}` : ''}.</p></div><Button variant="outline" size="sm" onClick={() => void loadDashboard()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Обновить</Button></header>
		<section className="management-filters dashboard-filters" aria-label="Фильтры аналитики">
			<div className="form-field"><label htmlFor="dashboard-store">Магазин</label><Select id="dashboard-store" value={storeId} onChange={(event) => setStoreId(event.target.value)} disabled={loadingStores}><option value="">Все доступные магазины</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.code}</option>)}</Select></div>
			<div className="form-field"><label htmlFor="dashboard-start">Начало периода (UTC)</label><input id="dashboard-start" className="field-control" type="date" value={range.start} onChange={(event) => setRange((value) => ({ ...value, start: event.target.value }))} /></div>
			<div className="form-field"><label htmlFor="dashboard-end">Конец периода (UTC)</label><input id="dashboard-end" className="field-control" type="date" value={range.end} onChange={(event) => setRange((value) => ({ ...value, end: event.target.value }))} /></div>
			<div className="dashboard-period"><CalendarDays size={15} /><span>{periodLabel}</span></div>
		</section>
		{error && <div className="management-error mb-3">{error}<button type="button" onClick={() => void loadDashboard()}>Повторить</button></div>}
		{loading && !overview ? <div className="management-surface management-state"><div><LoaderCircle className="mx-auto animate-spin text-muted-foreground" /><p>Загружаем аналитику…</p></div></div> : overview && photos && quizzes ? <>
			<section className="dashboard-metrics" aria-label="Ключевые показатели">
				<div className="dashboard-metric"><UsersRound size={17} /><strong>{overview.metrics.activeEmployeeCount}</strong><span>Активных сотрудников</span></div><div className="dashboard-metric"><BarChart3 size={17} /><strong>{overview.metrics.publishedQuizCount}</strong><span>Опубликованных тестов</span></div><div className="dashboard-metric"><strong>{overview.metrics.completedAttemptCount}</strong><span>Завершённых попыток</span><small>Сотрудников: {overview.metrics.completedEmployeeCount}</small></div><div className="dashboard-metric"><ImageIcon size={17} /><strong>{overview.metrics.uploadedPhotoCount}</strong><span>Загруженных фото</span><small>Уникальных авторов: {photos.distinctUploadingEmployeeCount}</small></div><div className="dashboard-metric"><strong>{nullablePercent(overview.metrics.averageCompletedAttemptScore)}</strong><span>Средний балл</span><small>Только завершённые попытки</small></div><div className="dashboard-metric"><strong>{nullablePercent(overview.metrics.passRate)}</strong><span>Процент прохождения</span><small>Нет данных отображается как «—»</small></div>
			</section>
			<div className="dashboard-grid"><section className="management-surface dashboard-panel"><div className="panel-header"><div><p className="eyebrow">Фотографии</p><h2 className="panel-title">Загрузки по дням</h2></div><Badge tone="blue">Всего: {photos.totalPhotoCount}</Badge></div><div className="dashboard-bars">{photos.dailyUploads.length === 0 ? <p className="role-note">За период нет данных.</p> : photos.dailyUploads.map((item) => <div className="dashboard-bar-row" key={item.date}><time>{item.date.slice(5)}</time><div className="dashboard-bar-track"><span style={{ width: `${(item.count / maxDaily) * 100}%` }} /></div><strong>{item.count}</strong></div>)}</div></section><section className="management-surface dashboard-panel"><div className="panel-header"><div><p className="eyebrow">Магазины</p><h2 className="panel-title">Фото по магазинам</h2></div><StoreIcon size={17} className="text-muted-foreground" /></div><div className="dashboard-store-list">{photos.perStoreUploads.length === 0 ? <p className="role-note">Нет доступных магазинов.</p> : photos.perStoreUploads.map((store) => <div className="dashboard-store-row" key={store.storeId}><span>{store.storeName}</span><strong>{store.count}</strong></div>)}</div></section></div>
			<section className="management-surface dashboard-panel"><div className="panel-header"><div><p className="eyebrow">Тесты</p><h2 className="panel-title">Результаты за период</h2></div><span className="role-note">Завершено: {quizzes.summary.completedAttemptCount} · Средний балл: {nullablePercent(quizzes.summary.averageScore)}</span></div>{quizzes.data.length === 0 ? <div className="management-state"><div><BarChart3 className="mx-auto text-muted-foreground" /><strong>Завершённых тестов нет</strong><p>За выбранный период API не вернул завершённых попыток.</p></div></div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Тест</th><th>Попытки</th><th>Сотрудники</th><th>Средний балл</th><th>Прохождение</th></tr></thead><tbody>{quizzes.data.map((quiz) => <tr key={quiz.quizId}><td><strong>{quiz.title}</strong></td><td>{quiz.completedAttemptCount}</td><td>{quiz.participatingEmployeeCount}</td><td>{nullablePercent(quiz.averageScore)}</td><td>{nullablePercent(quiz.passRate)}</td></tr>)}</tbody></table></div>}</section>
		</> : null}
	</div>
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Image as ImageIcon, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react'
import { photoReportDetailResponseSchema, photoReportListResponseSchema, photoReviewHistoryResponseSchema, storeListResponseSchema, userListResponseSchema, type PhotoReportDetailResponse, type PhotoReportResponse, type PhotoReviewStatus, type StoreResponse, type UserResponse } from '@vizaje/contracts'
import { useSessionUser } from '@/components/session-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, ManagementError, managementFetch, managementFetchNoContent } from '@/lib/management-client'

const PAGE_SIZE = 24

function errorMessage(error: unknown): string {
	if (!(error instanceof ManagementError)) return 'Не удалось загрузить фотографии'
	if (error.status === 401) return 'Сеанс завершён. Выполните вход снова'
	if (error.status === 403) return 'У вас нет доступа к выбранному магазину'
	if (error.status === 400) return 'Проверьте параметры запроса'
	if (error.status === 409) return 'Фотография уже была обработана другим сотрудником'
	if (error.status >= 500) return 'Сервис фотографий временно недоступен'
	return error.message || 'Не удалось загрузить фотографии'
}

function utcBoundary(value: string, end = false): string {
	const date = new Date(`${value}T00:00:00.000Z`)
	if (end) date.setUTCDate(date.getUTCDate() + 1)
	return date.toISOString()
}

function fileSize(value: number): string {
	if (value < 1024) return `${value} Б`
	if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`
	return `${(value / 1024 / 1024).toFixed(1)} МБ`
}

function statusLabel(status: PhotoReviewStatus): string {
	return status === 'checked' ? 'Проверено' : status === 'rejected' ? 'Отклонено' : 'На проверке'
}

function statusTone(status: PhotoReviewStatus): 'neutral' | 'green' | 'danger' {
	return status === 'checked' ? 'green' : status === 'rejected' ? 'danger' : 'neutral'
}

export function PhotosPage() {
	const currentUser = useSessionUser()
	const isAdmin = currentUser.role === 'admin'
	const canReview = currentUser.role === 'admin' || currentUser.role === 'manager'
	const [reports, setReports] = useState<PhotoReportResponse[]>([])
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [employees, setEmployees] = useState<UserResponse[]>([])
	const [storeId, setStoreId] = useState('')
	const [uploadedBy, setUploadedBy] = useState('')
	const [status, setStatus] = useState('')
	const [startDate, setStartDate] = useState('')
	const [endDate, setEndDate] = useState('')
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [selected, setSelected] = useState<PhotoReportResponse | null>(null)
	const [detail, setDetail] = useState<PhotoReportDetailResponse | null>(null)
	const [history, setHistory] = useState<Array<{ id: string; fromStatus: PhotoReviewStatus | null; toStatus: PhotoReviewStatus; comment: string | null; createdAt: string }>>([])
	const [reviewComment, setReviewComment] = useState('')
	const [reviewLoading, setReviewLoading] = useState(false)
	const [loading, setLoading] = useState(true)
	const [filtersLoading, setFiltersLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [filtersError, setFiltersError] = useState<string | null>(null)
	const [reviewError, setReviewError] = useState<string | null>(null)
	const [deleteId, setDeleteId] = useState<string | null>(null)
	const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({})

	useEffect(() => {
		let cancelled = false
		setFiltersLoading(true)
		Promise.all([
			managementFetch('/api/admin/stores?page=1&pageSize=100&sortBy=name&sortDirection=asc', storeListResponseSchema),
			managementFetch('/api/admin/employees?page=1&pageSize=100&sortBy=lastName&sortDirection=asc', userListResponseSchema),
		]).then(([storeResponse, employeeResponse]) => {
			if (cancelled) return
			setStores(storeResponse.data)
			setEmployees(employeeResponse.data)
			if (!isAdmin && !storeId && storeResponse.data[0]) setStoreId(storeResponse.data[0].id)
		}).catch((reason) => { if (!cancelled) setFiltersError(errorMessage(reason)) }).finally(() => { if (!cancelled) setFiltersLoading(false) })
		return () => { cancelled = true }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isAdmin])

	const loadReports = useCallback(async () => {
		if (!isAdmin && filtersLoading) return
		if (!isAdmin && !storeId) {
			setReports([])
			setPagination({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
			setLoading(false)
			return
		}
		if ((startDate && !endDate) || (!startDate && endDate)) {
			setError('Укажите обе даты периода')
			setLoading(false)
			return
		}
		if (startDate && endDate && startDate > endDate) {
			setError('Дата начала не может быть позже даты окончания')
			setLoading(false)
			return
		}
		setLoading(true)
		setError(null)
		const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
		if (storeId) params.set('storeId', storeId)
		if (uploadedBy) params.set('uploadedBy', uploadedBy)
		if (status) params.set('status', status)
		if (startDate && endDate) { params.set('startDate', utcBoundary(startDate)); params.set('endDate', utcBoundary(endDate, true)) }
		try {
			const response = await managementFetch(`/api/admin/photo-reports?${params}`, photoReportListResponseSchema)
			setReports(response.data)
			setPagination(response.pagination)
			if (selected && !response.data.some((report) => report.id === selected.id)) setSelected(null)
		} catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
	}, [endDate, filtersLoading, isAdmin, page, selected, startDate, status, storeId, uploadedBy])

	useEffect(() => { void loadReports() }, [loadReports])

	useEffect(() => {
		if (!selected) { setDetail(null); setHistory([]); return }
		let cancelled = false
		Promise.all([
			managementFetch(`/api/admin/photo-reports/${selected.id}`, photoReportDetailResponseSchema),
			managementFetch(`/api/admin/photo-reports/${selected.id}/history`, photoReviewHistoryResponseSchema),
		]).then(([report, historyResponse]) => {
			if (cancelled) return
			setDetail(report)
			setHistory(historyResponse.data)
		}).catch((reason) => { if (!cancelled) setReviewError(errorMessage(reason)) })
		return () => { cancelled = true }
	}, [selected])

	const storeNames = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores])
	const employeeNames = useMemo(() => new Map(employees.map((employee) => [employee.id, `${employee.firstName} ${employee.lastName}`])), [employees])

	function resetFilters() {
		setUploadedBy(''); setStatus(''); setStartDate(''); setEndDate(''); setPage(1)
		if (isAdmin) setStoreId('')
	}

	async function removePhoto(report: PhotoReportResponse) {
		const photo = report.currentVersion.photo
		if (!isAdmin || !window.confirm(`Удалить фотографию «${photo.originalFilename}»? Это действие нельзя отменить.`)) return
		setDeleteId(report.id)
		try {
			await managementFetchNoContent(`/api/admin/photos/${photo.id}`, { method: 'DELETE' })
			setReports((items) => items.filter((item) => item.id !== report.id))
			setPagination((value) => ({ ...value, total: Math.max(0, value.total - 1) }))
			if (selected?.id === report.id) setSelected(null)
		} catch (reason) { setError(errorMessage(reason)) } finally { setDeleteId(null) }
	}

	async function reviewReport(action: 'check' | 'reject') {
		if (!selected || !canReview || reviewLoading) return
		if (action === 'reject' && !reviewComment.trim()) { setReviewError('Укажите причину отклонения'); return }
		setReviewLoading(true); setReviewError(null)
		try {
			const response = await managementFetch(`/api/admin/photo-reports/${selected.id}/${action}`, photoReportDetailResponseSchema, { method: 'POST', body: JSON.stringify(action === 'reject' ? { comment: reviewComment.trim() } : { comment: reviewComment.trim() || undefined }) })
			setDetail(response); setSelected(response); setReviewComment('')
			const historyResponse = await managementFetch(`/api/admin/photo-reports/${selected.id}/history`, photoReviewHistoryResponseSchema)
			setHistory(historyResponse.data)
			setReports((items) => items.map((item) => item.id === response.id ? response : item))
		} catch (reason) { setReviewError(errorMessage(reason)) } finally { setReviewLoading(false) }
	}

	return <div className="management-page">
		<header className="page-header"><div><h1 className="page-title">Фотографии</h1><p className="page-subtitle">Приватная галерея и проверка загрузок сотрудников.</p></div><Button variant="outline" size="sm" onClick={() => void loadReports()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Обновить</Button></header>
		<section className="management-filters photos-filters" aria-label="Фильтры фотографий">
			<div className="form-field"><label htmlFor="photo-store">Магазин</label><Select id="photo-store" value={storeId} onChange={(event) => { setStoreId(event.target.value); setPage(1) }} disabled={filtersLoading || !isAdmin && stores.length === 0}><option value="">{isAdmin ? 'Все магазины' : 'Выберите магазин'}</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.code}</option>)}</Select></div>
			<div className="form-field"><label htmlFor="photo-employee">Сотрудник</label><Select id="photo-employee" value={uploadedBy} onChange={(event) => { setUploadedBy(event.target.value); setPage(1) }} disabled={filtersLoading}><option value="">Все сотрудники</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</Select></div>
			<div className="form-field"><label htmlFor="photo-status">Статус</label><Select id="photo-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">Все статусы</option><option value="pending">На проверке</option><option value="checked">Проверено</option><option value="rejected">Отклонено</option></Select></div>
			<div className="form-field"><label htmlFor="photo-start">Начало периода (UTC)</label><Input id="photo-start" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setPage(1) }} /></div>
			<div className="form-field"><label htmlFor="photo-end">Конец периода (UTC)</label><Input id="photo-end" type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setPage(1) }} /></div>
			<Button variant="ghost" size="sm" onClick={resetFilters}><X size={14} />Сбросить</Button>
		</section>
		{filtersError && <div className="management-error mb-3">{filtersError}</div>}
		{error && <div className="management-error mb-3">{error}<button type="button" onClick={() => void loadReports()}>Повторить</button></div>}
		<section className="management-surface photo-gallery-surface" aria-label="Галерея фотографий">
			{loading || filtersLoading ? <div className="management-state"><div><LoaderCircle className="mx-auto animate-spin text-muted-foreground" /><p>Загружаем фотографии…</p></div></div> : reports.length === 0 ? <div className="management-state"><div><ImageIcon className="mx-auto text-muted-foreground" /><strong>Фотографии не найдены</strong><p>В выбранном периоде нет доступных загрузок.</p></div></div> : <>
				<div className="photo-gallery">{reports.map((report) => { const photo = report.currentVersion.photo; return <article className="photo-card" key={report.id}>
					<button type="button" className="photo-thumbnail" onClick={() => { setSelected(report); setReviewError(null) }} aria-label={`Открыть ${photo.originalFilename}`}>
						{imageErrors[photo.id] ? <span className="photo-missing"><ImageIcon size={24} />Изображение недоступно</span> : <img src={`/api/admin/photos/${photo.id}/image`} alt={photo.originalFilename} loading="lazy" onError={() => setImageErrors((value) => ({ ...value, [photo.id]: true }))} />}
					</button>
					<div className="photo-card-body"><div className="photo-card-heading"><strong title={photo.originalFilename}>{photo.originalFilename}</strong>{isAdmin && <button type="button" className="row-more" aria-label={`Удалить ${photo.originalFilename}`} disabled={deleteId === report.id} onClick={() => void removePhoto(report)}>{deleteId === report.id ? <LoaderCircle size={15} className="animate-spin" /> : <Trash2 size={15} />}</button>}</div><p>{storeNames.get(report.storeId) ?? 'Магазин недоступен'}</p><p>{employeeNames.get(report.submittedBy) ?? 'Сотрудник недоступен'}</p><div className="flex items-center gap-2"><Badge tone={statusTone(report.currentVersion.status)}>{statusLabel(report.currentVersion.status)}</Badge>{report.versionCount > 1 && <small>Версия {report.currentVersion.versionNumber} из {report.versionCount}</small>}</div><small>{formatDate(report.currentVersion.submittedAt)} · {fileSize(photo.fileSize)}</small></div>
				</article> })}</div>
				<div className="management-pagination"><span>{pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} из {pagination.total}</span><div className="management-pagination-actions"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={15} /></button><span>{page} / {Math.max(pagination.totalPages, 1)}</span><button type="button" aria-label="Следующая страница" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight size={15} /></button></div></div>
			</>}
		</section>
		<Dialog open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.currentVersion.photo.originalFilename ?? 'Фотография'} className="photo-viewer-dialog">{selected && <div className="photo-viewer"><img src={`/api/admin/photos/${selected.currentVersion.photo.id}/image`} alt={selected.currentVersion.photo.originalFilename} /><div className="flex items-center gap-2"><Badge tone={statusTone((detail ?? selected).currentVersion.status)}>{statusLabel((detail ?? selected).currentVersion.status)}</Badge><span className="role-note">Версий: {(detail ?? selected).versionCount}</span></div><dl className="management-meta"><div><dt>Магазин</dt><dd>{storeNames.get(selected.storeId) ?? '—'}</dd></div><div><dt>Сотрудник</dt><dd>{employeeNames.get(selected.submittedBy) ?? '—'}</dd></div><div><dt>Загружено</dt><dd>{formatDate(selected.currentVersion.submittedAt)}</dd></div><div><dt>Файл</dt><dd>{selected.currentVersion.photo.mimeType} · {fileSize(selected.currentVersion.photo.fileSize)}</dd></div></dl>{(detail ?? selected).currentVersion.rejectionComment && <div className="management-error">Причина отклонения: {(detail ?? selected).currentVersion.rejectionComment}</div>}{detail && detail.versions.length > 1 && <div className="space-y-2"><h3 className="panel-title">Предыдущие версии</h3>{detail.versions.slice(1).map((version) => <a className="role-note block" href={`/api/admin/photos/${version.photo.id}/image`} target="_blank" rel="noreferrer" key={version.id}>Версия {version.versionNumber} · {statusLabel(version.status)} · {formatDate(version.submittedAt)}</a>)}</div>}{canReview && (detail ?? selected).currentVersion.status === 'pending' && <div className="space-y-3"><div className="form-field"><label htmlFor="review-comment">Комментарий проверки</label><Textarea id="review-comment" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="Для отклонения комментарий обязателен" maxLength={2000} /></div>{reviewError && <div className="management-error">{reviewError}</div>}<div className="flex gap-2"><Button onClick={() => void reviewReport('check')} disabled={reviewLoading}><Check size={15} />Проверено</Button><Button variant="outline" onClick={() => void reviewReport('reject')} disabled={reviewLoading}>{reviewLoading ? <LoaderCircle size={15} className="animate-spin" /> : <X size={15} />}Отклонить</Button></div></div>}{history.length > 0 && <div className="space-y-2"><h3 className="panel-title">История</h3>{history.map((entry) => <div className="role-note" key={entry.id}>{statusLabel(entry.toStatus)} · {formatDate(entry.createdAt)}{entry.comment ? ` · ${entry.comment}` : ''}</div>)}</div>}</div>}</Dialog>
	</div>
}

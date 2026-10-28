'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Image as ImageIcon, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react'
import { photoListResponseSchema, storeListResponseSchema, userListResponseSchema, type PhotoResponse, type StoreResponse, type UserResponse } from '@vizaje/contracts'
import { useSessionUser } from '@/components/session-provider'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDate, ManagementError, managementFetch, managementFetchNoContent } from '@/lib/management-client'

const PAGE_SIZE = 24

function errorMessage(error: unknown): string {
	if (!(error instanceof ManagementError)) return 'Не удалось загрузить фотографии'
	if (error.status === 401) return 'Сеанс завершён. Выполните вход снова'
	if (error.status === 403) return 'У вас нет доступа к выбранному магазину'
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

export function PhotosPage() {
	const currentUser = useSessionUser()
	const isAdmin = currentUser.role === 'admin'
	const [photos, setPhotos] = useState<PhotoResponse[]>([])
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [employees, setEmployees] = useState<UserResponse[]>([])
	const [storeId, setStoreId] = useState('')
	const [uploadedBy, setUploadedBy] = useState('')
	const [startDate, setStartDate] = useState('')
	const [endDate, setEndDate] = useState('')
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [selected, setSelected] = useState<PhotoResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [filtersLoading, setFiltersLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [filtersError, setFiltersError] = useState<string | null>(null)
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
		// The initial store selection must not restart metadata loading.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isAdmin])

	const loadPhotos = useCallback(async () => {
		if (!isAdmin && filtersLoading) return
		if (!isAdmin && !storeId) {
			setPhotos([])
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
		if (startDate && endDate) {
			params.set('startDate', utcBoundary(startDate))
			params.set('endDate', utcBoundary(endDate, true))
		}
		try {
			const response = await managementFetch(`/api/admin/photos?${params}`, photoListResponseSchema)
			setPhotos(response.data)
			setPagination(response.pagination)
			if (selected && !response.data.some((photo) => photo.id === selected.id)) setSelected(null)
		} catch (reason) {
			setError(errorMessage(reason))
		} finally {
			setLoading(false)
		}
	}, [endDate, filtersLoading, isAdmin, page, selected, startDate, storeId, uploadedBy])

	useEffect(() => { void loadPhotos() }, [loadPhotos])

	const storeNames = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores])
	const employeeNames = useMemo(() => new Map(employees.map((employee) => [employee.id, `${employee.firstName} ${employee.lastName}`])), [employees])

	function resetFilters() {
		setUploadedBy('')
		setStartDate('')
		setEndDate('')
		setPage(1)
		if (isAdmin) setStoreId('')
	}

	async function removePhoto(photo: PhotoResponse) {
		if (!isAdmin || !window.confirm(`Удалить фотографию «${photo.originalFilename}»? Это действие нельзя отменить.`)) return
		setDeleteId(photo.id)
		try {
			await managementFetchNoContent(`/api/admin/photos/${photo.id}`, { method: 'DELETE' })
			setPhotos((items) => items.filter((item) => item.id !== photo.id))
			setPagination((value) => ({ ...value, total: Math.max(0, value.total - 1) }))
			if (selected?.id === photo.id) setSelected(null)
		} catch (reason) {
			setError(errorMessage(reason))
		} finally { setDeleteId(null) }
	}

	return <div className="management-page">
		<header className="page-header"><div><h1 className="page-title">Фотографии</h1><p className="page-subtitle">Приватная галерея загруженных фотографий из доступных магазинов.</p></div><Button variant="outline" size="sm" onClick={() => void loadPhotos()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Обновить</Button></header>
		<section className="management-filters photos-filters" aria-label="Фильтры фотографий">
			<div className="form-field"><label htmlFor="photo-store">Магазин</label><Select id="photo-store" value={storeId} onChange={(event) => { setStoreId(event.target.value); setPage(1) }} disabled={filtersLoading || !isAdmin && stores.length === 0}><option value="">{isAdmin ? 'Все магазины' : 'Выберите магазин'}</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.code}</option>)}</Select></div>
			<div className="form-field"><label htmlFor="photo-employee">Сотрудник</label><Select id="photo-employee" value={uploadedBy} onChange={(event) => { setUploadedBy(event.target.value); setPage(1) }} disabled={filtersLoading}><option value="">Все сотрудники</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</Select></div>
			<div className="form-field"><label htmlFor="photo-start">Начало периода (UTC)</label><Input id="photo-start" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setPage(1) }} /></div>
			<div className="form-field"><label htmlFor="photo-end">Конец периода (UTC)</label><Input id="photo-end" type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setPage(1) }} /></div>
			<Button variant="ghost" size="sm" onClick={resetFilters}><X size={14} />Сбросить</Button>
		</section>
		{filtersError && <div className="management-error mb-3">{filtersError}</div>}
		{error && <div className="management-error mb-3">{error}<button type="button" onClick={() => void loadPhotos()}>Повторить</button></div>}
		<section className="management-surface photo-gallery-surface" aria-label="Галерея фотографий">
			{loading || filtersLoading ? <div className="management-state"><div><LoaderCircle className="mx-auto animate-spin text-muted-foreground" /><p>Загружаем фотографии…</p></div></div> : photos.length === 0 ? <div className="management-state"><div><ImageIcon className="mx-auto text-muted-foreground" /><strong>Фотографии не найдены</strong><p>{isAdmin ? 'В выбранном периоде ещё нет загруженных фотографий.' : 'В доступных магазинах ещё нет фотографий за выбранный период.'}</p></div></div> : <>
				<div className="photo-gallery">{photos.map((photo) => <article className="photo-card" key={photo.id}>
					<button type="button" className="photo-thumbnail" onClick={() => setSelected(photo)} aria-label={`Открыть ${photo.originalFilename}`}>
						{imageErrors[photo.id] ? <span className="photo-missing"><ImageIcon size={24} />Изображение недоступно</span> : <img src={`/api/admin/photos/${photo.id}/image`} alt={photo.originalFilename} loading="lazy" onError={() => setImageErrors((value) => ({ ...value, [photo.id]: true }))} />}
					</button>
					<div className="photo-card-body"><div className="photo-card-heading"><strong title={photo.originalFilename}>{photo.originalFilename}</strong>{isAdmin && <button type="button" className="row-more" aria-label={`Удалить ${photo.originalFilename}`} disabled={deleteId === photo.id} onClick={() => void removePhoto(photo)}>{deleteId === photo.id ? <LoaderCircle size={15} className="animate-spin" /> : <Trash2 size={15} />}</button>}</div><p>{storeNames.get(photo.storeId) ?? 'Магазин недоступен'}</p><p>{employeeNames.get(photo.uploadedBy) ?? 'Сотрудник недоступен'}</p><small>{formatDate(photo.createdAt)} · {fileSize(photo.fileSize)}</small></div>
				</article>)}</div>
				<div className="management-pagination"><span>{(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} из {pagination.total}</span><div className="management-pagination-actions"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={15} /></button><span>{page} / {Math.max(pagination.totalPages, 1)}</span><button type="button" aria-label="Следующая страница" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight size={15} /></button></div></div>
			</>}
		</section>
		<Dialog open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.originalFilename ?? 'Фотография'} className="photo-viewer-dialog">{selected && <div className="photo-viewer"><img src={`/api/admin/photos/${selected.id}/image`} alt={selected.originalFilename} /><dl className="management-meta"><div><dt>Магазин</dt><dd>{storeNames.get(selected.storeId) ?? '—'}</dd></div><div><dt>Сотрудник</dt><dd>{employeeNames.get(selected.uploadedBy) ?? '—'}</dd></div><div><dt>Загружено</dt><dd>{formatDate(selected.createdAt)}</dd></div><div><dt>Файл</dt><dd>{selected.mimeType} · {fileSize(selected.fileSize)}</dd></div></dl></div>}</Dialog>
	</div>
}

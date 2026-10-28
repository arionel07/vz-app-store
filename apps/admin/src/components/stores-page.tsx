'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Edit3, LoaderCircle, Plus, RefreshCw, Search, Store as StoreIcon } from 'lucide-react'
import { toast } from 'sonner'
import { createStoreSchema, storeListResponseSchema, storeResponseSchema, updateStoreSchema, type StoreResponse } from '@vizaje/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSessionUser } from '@/components/session-provider'
import { formatDate, ManagementError, managementFetch } from '@/lib/management-client'

const PAGE_SIZE = 15

type FormState = { name: string; code: string; isActive: boolean }

function emptyForm(): FormState { return { name: '', code: '', isActive: true } }

function errorMessage(error: unknown): string {
	if (!(error instanceof ManagementError)) return 'Не удалось выполнить запрос'
	if (error.code === 'STORE_CODE_EXISTS') return 'Магазин с таким кодом уже существует'
	if (error.status === 403) return 'Только администратор может управлять магазинами'
	if (error.status === 401) return 'Сеанс завершён. Выполните вход снова'
	if (error.status >= 500) return 'Сервис временно недоступен'
	return 'Не удалось выполнить запрос'
}

export function StoresPage() {
	const user = useSessionUser()
	const isAdmin = user.role === 'admin'
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [selected, setSelected] = useState<StoreResponse | null>(null)
	const [search, setSearch] = useState('')
	const [activeFilter, setActiveFilter] = useState<'true' | 'false'>('true')
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [loading, setLoading] = useState(true)
	const [detailLoading, setDetailLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [dialog, setDialog] = useState<'create' | 'edit' | null>(null)
	const [form, setForm] = useState<FormState>(emptyForm)
	const [formError, setFormError] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)
	const [actionId, setActionId] = useState<string | null>(null)

	const loadStores = useCallback(async () => {
		setLoading(true)
		setError(null)
		const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortBy: 'name', sortDirection: 'asc', isActive: activeFilter })
		if (search.trim()) params.set('search', search.trim())
		try {
			const response = await managementFetch(`/api/admin/stores?${params}`, storeListResponseSchema)
			setStores(response.data)
			setPagination(response.pagination)
			setSelected((current) => current ? response.data.find((store) => store.id === current.id) ?? null : response.data[0] ?? null)
		} catch (requestError) {
			if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login')
			else setError(errorMessage(requestError))
		} finally {
			setLoading(false)
		}
	}, [activeFilter, page, search])

	useEffect(() => { void loadStores() }, [loadStores])

	async function selectStore(store: StoreResponse) {
		setSelected(store)
		setDetailLoading(true)
		try {
			setSelected(await managementFetch(`/api/admin/stores/${store.id}`, storeResponseSchema))
		} catch (requestError) {
			if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login')
			else toast.error(errorMessage(requestError))
		} finally {
			setDetailLoading(false)
		}
	}

	function openCreate() {
		setForm(emptyForm())
		setFormError(null)
		setDialog('create')
	}

	function openEdit() {
		if (!selected || !isAdmin) return
		setForm({ name: selected.name, code: selected.code, isActive: selected.isActive })
		setFormError(null)
		setDialog('edit')
	}

	async function saveStore(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		setSaving(true)
		try {
			if (dialog === 'create') {
				const parsed = createStoreSchema.safeParse(form)
				if (!parsed.success) throw new Error('FORM_INVALID')
				setSelected(await managementFetch('/api/admin/stores', storeResponseSchema, { method: 'POST', body: JSON.stringify(parsed.data) }))
			} else if (dialog === 'edit' && selected) {
				const parsed = updateStoreSchema.safeParse(form)
				if (!parsed.success) throw new Error('FORM_INVALID')
				setSelected(await managementFetch(`/api/admin/stores/${selected.id}`, storeResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed.data) }))
			}
			setDialog(null)
			await loadStores()
			toast.success('Данные магазина сохранены')
		} catch (requestError) {
			setFormError(requestError instanceof Error && requestError.message === 'FORM_INVALID' ? 'Название и код магазина обязательны' : errorMessage(requestError))
		} finally {
			setSaving(false)
		}
	}

	async function toggleActive() {
		if (!selected || !isAdmin) return
		const next = !selected.isActive
		if (!window.confirm(next ? 'Активировать магазин?' : 'Деактивировать магазин?')) return
		setActionId(selected.id)
		try {
			const updated = await managementFetch(`/api/admin/stores/${selected.id}/${next ? 'activate' : 'deactivate'}`, storeResponseSchema, { method: 'POST' })
			setSelected(updated)
			await loadStores()
			toast.success(next ? 'Магазин активирован' : 'Магазин деактивирован')
		} catch (requestError) {
			toast.error(errorMessage(requestError))
		} finally {
			setActionId(null)
		}
	}

	return (
		<div className="management-page">
			<header className="management-toolbar"><div><p className="eyebrow">Рабочая область</p><h1 className="page-title">Магазины</h1><p className="page-subtitle">Доступные магазины из API с учётом вашей области доступа</p></div><div className="management-toolbar-actions"><Button variant="outline" size="sm" onClick={() => void loadStores()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Обновить</Button>{isAdmin && <Button size="sm" onClick={openCreate}><Plus size={14} />Добавить магазин</Button>}</div></header>
			<div className="management-filters"><label className="sr-only" htmlFor="store-search">Поиск магазинов</label><div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input id="store-search" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value) }} placeholder="Поиск по названию или коду" className="pl-9" /></div><label className="sr-only" htmlFor="store-status">Статус</label><Select id="store-status" value={activeFilter} onChange={(event) => { setPage(1); setActiveFilter(event.target.value as 'true' | 'false') }}><option value="true">Активные</option><option value="false">Неактивные</option></Select><div className="flex items-center justify-end text-xs text-muted-foreground">{isAdmin ? 'Полный доступ администратора' : 'Только магазины вашей области'}</div></div>
			{error && <div className="management-error" role="alert">{error}<button type="button" onClick={() => void loadStores()}>Повторить</button></div>}
			<div className="management-grid mt-3"><section className="management-surface" aria-label="Список магазинов">{loading ? <div className="management-state"><div><LoaderCircle className="mx-auto animate-spin text-muted-foreground" /><p>Загружаем магазины…</p></div></div> : stores.length === 0 ? <div className="management-state"><div><StoreIcon className="mx-auto text-muted-foreground" /><strong>Магазины не найдены</strong><p>Для выбранного статуса и фильтра нет данных в вашей области доступа.</p></div></div> : <><Table className="management-table"><TableHeader><TableRow><TableHead>Магазин</TableHead><TableHead>Код</TableHead><TableHead>Создан</TableHead><TableHead>Изменён</TableHead><TableHead>Статус</TableHead><TableHead aria-label="Действия" /></TableRow></TableHeader><TableBody>{stores.map((store) => <TableRow key={store.id} aria-selected={selected?.id === store.id} onClick={() => void selectStore(store)}><TableCell><div className="employee-name-cell"><span className="store-symbol"><StoreIcon size={15} /></span><div><strong>{store.name}</strong><small>{store.id}</small></div></div></TableCell><TableCell>{store.code}</TableCell><TableCell className="cell-muted">{formatDate(store.createdAt)}</TableCell><TableCell className="cell-muted">{formatDate(store.updatedAt)}</TableCell><TableCell><Badge tone={store.isActive ? 'green' : 'danger'}>{store.isActive ? 'Активен' : 'Неактивен'}</Badge></TableCell><TableCell className="actions-cell">{isAdmin && <button type="button" className="row-more" aria-label={`Изменить ${store.name}`} onClick={(event) => { event.stopPropagation(); void selectStore(store).then(openEdit) }}><Edit3 size={15} /></button>}</TableCell></TableRow>)}</TableBody></Table><div className="management-pagination"><span>{pagination.total === 0 ? 'Нет магазинов' : `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} из ${pagination.total}`}</span><div className="management-pagination-actions"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /></button><span>{page} / {Math.max(pagination.totalPages, 1)}</span><button type="button" aria-label="Следующая страница" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight size={15} /></button></div></div></>}</section><aside className="management-surface management-inspector" aria-label="Карточка магазина">{!selected ? <div className="management-state"><div><StoreIcon className="mx-auto text-muted-foreground" /><p>Выберите магазин, чтобы увидеть детали.</p></div></div> : <><div className="panel-header"><div><p className="eyebrow">Карточка</p><h2 className="panel-title">{selected.name}</h2></div>{isAdmin && <Button variant="ghost" size="icon-sm" aria-label="Редактировать магазин" onClick={openEdit}><Edit3 /></Button>}</div><div className="panel-content"><div className="flex items-center gap-3"><span className="store-symbol"><StoreIcon size={17} /></span><div><strong>{selected.code}</strong><p className="panel-description">{detailLoading ? 'Загрузка…' : selected.isActive ? 'Магазин доступен' : 'Магазин отключён'}</p></div></div><dl className="management-meta"><div><dt>Идентификатор</dt><dd className="max-w-[180px] truncate">{selected.id}</dd></div><div><dt>Создан</dt><dd>{formatDate(selected.createdAt)}</dd></div><div><dt>Изменён</dt><dd>{formatDate(selected.updatedAt)}</dd></div></dl>{isAdmin && <div className="management-actions"><Button variant="outline" size="sm" onClick={openEdit}><Edit3 size={14} />Изменить</Button><Button variant={selected.isActive ? 'destructive' : 'outline'} size="sm" disabled={actionId === selected.id} onClick={() => void toggleActive()}>{actionId === selected.id && <LoaderCircle size={14} className="animate-spin" />}{selected.isActive ? 'Деактивировать' : 'Активировать'}</Button></div>}<p className="role-note">Связи сотрудников управляются на странице «Сотрудники» через реальные назначения stores API.</p></div></>}</aside></div>
			<Dialog open={dialog !== null} onClose={() => { if (!saving) setDialog(null) }} title={dialog === 'create' ? 'Новый магазин' : 'Редактировать магазин'} className="max-w-[520px]"><form className="dialog-form" onSubmit={saveStore}><div className="form-grid"><div className="form-field form-field-full"><label htmlFor="store-name">Название</label><Input id="store-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div><div className="form-field"><label htmlFor="store-code">Код</label><Input id="store-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required /></div><div className="form-field"><label className="flex items-center gap-2"><input type="checkbox" className="checkbox-control" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />Доступ активен</label></div></div>{formError && <div className="management-error mt-3" role="alert">{formError}</div>}<div className="form-actions"><Button type="button" variant="ghost" onClick={() => setDialog(null)} disabled={saving}>Отмена</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle size={14} className="animate-spin" />}Сохранить</Button></div></form></Dialog>
		</div>
	)
}

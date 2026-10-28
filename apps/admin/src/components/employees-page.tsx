'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Edit3, LoaderCircle, Plus, QrCode, RefreshCw, Search, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import {
	activationRequestSchema,
	activationResponseSchema,
	createUserSchema,
	storeListResponseSchema,
	updateUserSchema,
	userListResponseSchema,
	userResponseSchema,
	userRoleSchema,
	type StoreResponse,
	type UserResponse,
} from '@vizaje/contracts'
import { ActivationQr } from '@/components/activation-qr'
import { useSessionUser } from '@/components/session-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, ManagementError, managementFetch } from '@/lib/management-client'

const PAGE_SIZE = 15
const roleLabels = { admin: 'Администратор', manager: 'Менеджер', staff: 'Сотрудник' } as const

type FormState = {
	firstName: string
	lastName: string
	phone: string
	email: string
	role: UserResponse['role']
	isActive: boolean
	storeIds: string[]
}

type Activation = { payload: string; expiresAt: string }

function initials(employee: UserResponse): string {
	return `${employee.firstName[0] ?? ''}${employee.lastName[0] ?? ''}`.toUpperCase()
}

function emptyForm(): FormState {
	return { firstName: '', lastName: '', phone: '', email: '', role: 'staff', isActive: true, storeIds: [] }
}

function formFromEmployee(employee: UserResponse): FormState {
	return {
		firstName: employee.firstName,
		lastName: employee.lastName,
		phone: employee.phone ?? '',
		email: employee.email ?? '',
		role: employee.role,
		isActive: employee.isActive,
		storeIds: employee.storeIds,
	}
}

function errorMessage(error: unknown): string {
	if (!(error instanceof ManagementError)) return 'Не удалось выполнить запрос'
	if (error.code === 'USER_ALREADY_EXISTS') return 'Сотрудник с таким телефоном или email уже существует'
	if (error.code === 'STORE_UNAVAILABLE') return 'Один из выбранных магазинов недоступен'
	if (error.code === 'MEMBERSHIP_EXISTS') return 'Сотрудник уже назначен в этот магазин'
	if (error.code === 'MEMBERSHIP_NOT_FOUND') return 'Назначение магазина уже удалено'
	if (error.code === 'ACTIVATION_UNAVAILABLE') return 'Для этого сотрудника активация сейчас недоступна'
	if (error.code === 'RATE_LIMITED') return 'Слишком много запросов. Попробуйте позже'
	if (error.status === 403) return 'У вас нет прав для этой операции'
	if (error.status === 401) return 'Сеанс завершён. Выполните вход снова'
	if (error.status >= 500) return 'Сервис временно недоступен'
	return 'Не удалось выполнить запрос'
}

export function EmployeesPage() {
	const currentUser = useSessionUser()
	const isAdmin = currentUser.role === 'admin'
	const [employees, setEmployees] = useState<UserResponse[]>([])
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [selected, setSelected] = useState<UserResponse | null>(null)
	const [search, setSearch] = useState('')
	const [role, setRole] = useState('all')
	const [activeFilter, setActiveFilter] = useState<'true' | 'false'>('true')
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [detailLoading, setDetailLoading] = useState(false)
	const [dialog, setDialog] = useState<'create' | 'edit' | null>(null)
	const [form, setForm] = useState<FormState>(emptyForm)
	const [formError, setFormError] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)
	const [actionId, setActionId] = useState<string | null>(null)
	const [activation, setActivation] = useState<Activation | null>(null)
	const [activationStoreId, setActivationStoreId] = useState('')

	const loadData = useCallback(async () => {
		setLoading(true)
		setError(null)
		const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortBy: 'lastName', sortDirection: 'asc' })
		if (search.trim()) params.set('search', search.trim())
		if (role !== 'all') params.set('role', role)
		params.set('isActive', activeFilter)

		try {
			const [list, activeStoreList, inactiveStoreList] = await Promise.all([
				managementFetch(`/api/admin/employees?${params}`, userListResponseSchema),
				managementFetch('/api/admin/stores?page=1&pageSize=100&isActive=true&sortBy=name&sortDirection=asc', storeListResponseSchema),
				isAdmin ? managementFetch('/api/admin/stores?page=1&pageSize=100&isActive=false&sortBy=name&sortDirection=asc', storeListResponseSchema) : Promise.resolve(null),
			])
			const storeList = [...activeStoreList.data, ...(inactiveStoreList?.data ?? [])]
			setEmployees(list.data)
			setPagination(list.pagination)
			setStores(storeList)
			setSelected((current) => {
				const match = current ? list.data.find((employee) => employee.id === current.id) : list.data[0]
				return match ?? null
			})
		} catch (requestError) {
			if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login')
			else setError(errorMessage(requestError))
		} finally {
			setLoading(false)
		}
	}, [activeFilter, isAdmin, page, role, search])

	useEffect(() => { void loadData() }, [loadData])

	async function selectEmployee(employee: UserResponse) {
		setSelected(employee)
		setDetailLoading(true)
		try {
			setSelected(await managementFetch(`/api/admin/employees/${employee.id}`, userResponseSchema))
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
		if (!selected) return
		setForm(formFromEmployee(selected))
		setFormError(null)
		setDialog('edit')
	}

	function closeDialog() {
		if (!saving) setDialog(null)
	}

	function toggleStore(storeId: string) {
		setForm((current) => ({ ...current, storeIds: current.storeIds.includes(storeId) ? current.storeIds.filter((id) => id !== storeId) : [...current.storeIds, storeId] }))
	}

	async function saveEmployee(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		setSaving(true)
		const payload = {
			firstName: form.firstName,
			lastName: form.lastName,
			phone: form.phone.trim() || null,
			email: form.email.trim() || null,
			role: form.role,
			isActive: form.isActive,
			storeIds: form.storeIds,
		}

		try {
			if (dialog === 'create') {
				const parsed = createUserSchema.safeParse(payload)
				if (!parsed.success) throw new Error('FORM_INVALID')
				const created = await managementFetch('/api/admin/employees', userResponseSchema, { method: 'POST', body: JSON.stringify(parsed.data) })
				setSelected(created)
			} else if (dialog === 'edit' && selected) {
				const parsed = updateUserSchema.safeParse({ firstName: form.firstName, lastName: form.lastName, phone: payload.phone, email: payload.email, role: form.role, isActive: form.isActive })
				if (!parsed.success) throw new Error('FORM_INVALID')
				let updated = await managementFetch(`/api/admin/employees/${selected.id}`, userResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed.data) })
				const before = new Set(selected.storeIds)
				const after = new Set(form.storeIds)
				for (const storeId of form.storeIds) {
					if (!before.has(storeId)) updated = await managementFetch(`/api/admin/employees/${selected.id}/stores/${storeId}`, userResponseSchema, { method: 'POST' })
				}
				for (const storeId of selected.storeIds) {
					if (!after.has(storeId)) updated = await managementFetch(`/api/admin/employees/${selected.id}/stores/${storeId}`, userResponseSchema, { method: 'DELETE' })
				}
				setSelected(updated)
			}
			setDialog(null)
			await loadData()
			toast.success('Данные сотрудника сохранены')
		} catch (requestError) {
			setFormError(requestError instanceof Error && requestError.message === 'FORM_INVALID' ? 'Проверьте обязательные поля и формат контактов' : errorMessage(requestError))
		} finally {
			setSaving(false)
		}
	}

	async function toggleActive() {
		if (!selected) return
		const next = !selected.isActive
		if (!window.confirm(next ? 'Активировать сотрудника?' : 'Деактивировать сотрудника?')) return
		setActionId(selected.id)
		try {
			const updated = await managementFetch(`/api/admin/employees/${selected.id}/${next ? 'activate' : 'deactivate'}`, userResponseSchema, { method: 'POST' })
			setSelected(updated)
			await loadData()
			toast.success(next ? 'Сотрудник активирован' : 'Сотрудник деактивирован')
		} catch (requestError) {
			toast.error(errorMessage(requestError))
		} finally {
			setActionId(null)
		}
	}

	async function generateActivation() {
		if (!selected || selected.role !== 'staff' || !selected.isActive || !activationStoreId) return
		setActionId(selected.id)
		try {
			const input = activationRequestSchema.parse({ userId: selected.id, storeId: activationStoreId })
			const response = await managementFetch('/api/admin/activation', activationResponseSchema, { method: 'POST', body: JSON.stringify(input) })
			setActivation({ payload: response.activationPayload, expiresAt: response.expiresAt })
		} catch (requestError) {
			toast.error(errorMessage(requestError))
		} finally {
			setActionId(null)
		}
	}

	function closeActivation() {
		setActivation(null)
		setActivationStoreId('')
	}

	const selectedStoreNames = useMemo(() => selected?.storeIds.map((id) => stores.find((store) => store.id === id)?.name ?? 'Недоступный магазин') ?? [], [selected, stores])
	const availableActivationStores = selected ? stores.filter((store) => store.isActive && selected.storeIds.includes(store.id)) : []

	return (
		<div className="management-page">
			<header className="management-toolbar">
				<div><p className="eyebrow">Рабочая область</p><h1 className="page-title">Сотрудники</h1><p className="page-subtitle">Реестр сотрудников и доступ к магазинам из API</p></div>
				<div className="management-toolbar-actions"><Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Обновить</Button><Button size="sm" onClick={openCreate}><Plus size={14} />Добавить сотрудника</Button></div>
			</header>
			<div className="management-filters">
				<label className="sr-only" htmlFor="employee-search">Поиск сотрудников</label><div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input id="employee-search" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value) }} placeholder="Поиск по имени или email" className="pl-9" /></div>
				<label className="sr-only" htmlFor="employee-role">Роль</label><Select id="employee-role" value={role} onChange={(event) => { setPage(1); setRole(event.target.value) }}><option value="all">Все роли</option><option value="staff">Сотрудники</option><option value="manager">Менеджеры</option><option value="admin">Администраторы</option></Select>
				<label className="sr-only" htmlFor="employee-status">Статус</label><Select id="employee-status" value={activeFilter} onChange={(event) => { setPage(1); setActiveFilter(event.target.value as 'true' | 'false') }}><option value="true">Активные</option><option value="false">Неактивные</option></Select>
			</div>
			{error && <div className="management-error" role="alert">{error}<button type="button" onClick={() => void loadData()}>Повторить</button></div>}
			<div className="management-grid mt-3">
				<section className="management-surface" aria-label="Список сотрудников">
					{loading ? <div className="management-state"><div><LoaderCircle className="mx-auto animate-spin text-muted-foreground" /><p>Загружаем сотрудников…</p></div></div> : employees.length === 0 ? <div className="management-state"><div><UserRound className="mx-auto text-muted-foreground" /><strong>Сотрудники не найдены</strong><p>Измените фильтры или добавьте сотрудника с реальными данными.</p></div></div> : <><Table className="management-table"><TableHeader><TableRow><TableHead>Сотрудник</TableHead><TableHead>Роль</TableHead><TableHead>Магазины</TableHead><TableHead>Изменён</TableHead><TableHead>Статус</TableHead><TableHead aria-label="Действия" /></TableRow></TableHeader><TableBody>{employees.map((employee) => <TableRow key={employee.id} aria-selected={selected?.id === employee.id} onClick={() => void selectEmployee(employee)}><TableCell><div className="employee-name-cell"><span className="avatar avatar-slate">{initials(employee)}</span><div><strong>{employee.firstName} {employee.lastName}</strong><small>{employee.email ?? employee.phone ?? 'Контакт не указан'}</small></div></div></TableCell><TableCell>{roleLabels[employee.role]}</TableCell><TableCell>{employee.storeIds.length}</TableCell><TableCell className="cell-muted">{formatDate(employee.updatedAt)}</TableCell><TableCell><Badge tone={employee.isActive ? 'green' : 'danger'}>{employee.isActive ? 'Активен' : 'Неактивен'}</Badge></TableCell><TableCell className="actions-cell"><button type="button" className="row-more" aria-label={`Изменить ${employee.firstName} ${employee.lastName}`} onClick={(event) => { event.stopPropagation(); void selectEmployee(employee).then(() => openEdit()) }}><Edit3 size={15} /></button></TableCell></TableRow>)}</TableBody></Table><div className="management-pagination"><span>{pagination.total === 0 ? 'Нет сотрудников' : `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} из ${pagination.total}`}</span><div className="management-pagination-actions"><button type="button" aria-label="Предыдущая страница" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /></button><span>{page} / {Math.max(pagination.totalPages, 1)}</span><button type="button" aria-label="Следующая страница" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight size={15} /></button></div></div></>}
				</section>
				<aside className="management-surface management-inspector" aria-label="Карточка сотрудника">
					{!selected ? <div className="management-state"><div><UserRound className="mx-auto text-muted-foreground" /><p>Выберите сотрудника, чтобы увидеть детали.</p></div></div> : <><div className="panel-header"><div><p className="eyebrow">Карточка</p><h2 className="panel-title">{selected.firstName} {selected.lastName}</h2></div><Button variant="ghost" size="icon-sm" aria-label="Редактировать сотрудника" onClick={openEdit}><Edit3 /></Button></div><div className="panel-content"><div className="flex items-center gap-3"><span className="avatar avatar-slate">{initials(selected)}</span><div><strong>{roleLabels[selected.role]}</strong><p className="panel-description">{selected.isActive ? 'Доступ активен' : 'Доступ отключён'}</p></div></div><dl className="management-meta"><div><dt>Email</dt><dd>{selected.email ?? '—'}</dd></div><div><dt>Телефон</dt><dd>{selected.phone ?? '—'}</dd></div><div><dt>Магазины</dt><dd>{selectedStoreNames.length ? selectedStoreNames.join(', ') : 'Не назначены'}</dd></div><div><dt>Обновлён</dt><dd>{detailLoading ? 'Загрузка…' : formatDate(selected.updatedAt)}</dd></div></dl><div className="management-actions"><Button variant="outline" size="sm" onClick={openEdit}><Edit3 size={14} />Изменить</Button><Button variant={selected.isActive ? 'destructive' : 'outline'} size="sm" disabled={actionId === selected.id} onClick={() => void toggleActive()}>{actionId === selected.id && <LoaderCircle size={14} className="animate-spin" />}{selected.isActive ? 'Деактивировать' : 'Активировать'}</Button></div>{selected.role === 'staff' && selected.isActive && <div className="border-t border-border pt-3"><p className="eyebrow">Активация приложения</p>{availableActivationStores.length ? <><label className="form-field"><span>Магазин для активации</span><Select value={activationStoreId} onChange={(event) => setActivationStoreId(event.target.value)}><option value="">Выберите магазин</option>{availableActivationStores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.code}</option>)}</Select></label><Button className="mt-2 w-full" size="sm" disabled={!activationStoreId || actionId === selected.id} onClick={() => void generateActivation()}><QrCode size={14} />Сгенерировать QR</Button></> : <p className="role-note">Назначьте сотруднику активный магазин, чтобы создать код.</p>}</div>}</div></>}
				</aside>
			</div>

			<Dialog open={dialog !== null} onClose={closeDialog} title={dialog === 'create' ? 'Новый сотрудник' : 'Редактировать сотрудника'} className="max-w-[680px]"><form className="dialog-form" onSubmit={saveEmployee}><div className="form-grid"><div className="form-field"><label htmlFor="employee-first-name">Имя</label><Input id="employee-first-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} autoComplete="given-name" required /></div><div className="form-field"><label htmlFor="employee-last-name">Фамилия</label><Input id="employee-last-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} autoComplete="family-name" required /></div><div className="form-field"><label htmlFor="employee-email">Email</label><Input id="employee-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" placeholder="name@example.com" /></div><div className="form-field"><label htmlFor="employee-phone">Телефон</label><Input id="employee-phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} autoComplete="tel" placeholder="+79991234567" /></div><div className="form-field"><label htmlFor="employee-form-role">Роль</label><Select id="employee-form-role" value={form.role} disabled={dialog === 'edit' && selected?.role === 'manager'} onChange={(event) => setForm({ ...form, role: userRoleSchema.parse(event.target.value) })}><option value="staff">Сотрудник</option><option value="manager">Менеджер</option><option value="admin">Администратор</option></Select>{dialog === 'edit' && selected?.role === 'manager' && <p className="role-note">Менеджер может управлять только сотрудниками в своей области.</p>}</div><div className="form-field"><label className="flex items-center gap-2"><input type="checkbox" className="checkbox-control" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />Доступ активен</label></div><div className="form-field form-field-full"><fieldset><legend>Магазины сотрудника</legend><div className="store-checklist">{stores.length ? stores.map((store) => <label className="store-check" key={store.id}><input type="checkbox" checked={form.storeIds.includes(store.id)} onChange={() => toggleStore(store.id)} /><span>{store.name}</span><small className="ml-auto text-muted-foreground">{store.code}</small></label>) : <p className="role-note">Активные магазины не найдены или недоступны вашей роли.</p>}</div></fieldset></div></div>{formError && <div className="management-error mt-3" role="alert">{formError}</div>}<div className="form-actions"><Button type="button" variant="ghost" onClick={closeDialog} disabled={saving}>Отмена</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle size={14} className="animate-spin" />}Сохранить</Button></div></form></Dialog>
			<Dialog open={activation !== null} onClose={closeActivation} title="QR-код активации" className="max-w-[390px]">{activation && <ActivationQr payload={activation.payload} expiresAt={activation.expiresAt} />}<div className="form-actions"><Button type="button" onClick={closeActivation}><Check size={14} />Готово</Button></div></Dialog>
		</div>
	)
}

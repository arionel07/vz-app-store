'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, History, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
	DEFAULT_SCHEDULE_TIME_ZONE,
	scheduleDateInTimeZone,
	scheduleDayOffCreateSchema,
	scheduleDayOffUpdateSchema,
	scheduleHistoryResponseSchema,
	scheduleListResponseSchema,
	schedulePeriodCreateSchema,
	schedulePeriodResponseSchema,
	scheduleShiftCreateSchema,
	scheduleShiftUpdateSchema,
	shiftScheduleDate,
	scheduleWeekStart,
	storeListResponseSchema,
	userListResponseSchema,
	type ScheduleHistoryResponse,
	type SchedulePeriodResponse,
	type StoreResponse,
	type UserResponse,
} from '@vizaje/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { managementFetch, ManagementError } from '@/lib/management-client'

type EntryForm = {
	kind: 'shift' | 'day_off'
	id: string | null
	employeeId: string
	employeeName: string
	localDate: string
	startTime: string
	endTime: string
	note: string
}
type EntryField = 'localDate' | 'startTime' | 'endTime'

function dateLabel(value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
	return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function weekdayLabel(value: string): string {
	return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)).replace('.', '')
}

function errorText(error: unknown): string {
	if (error instanceof ManagementError) {
		if (error.code === 'SHIFT_OVERLAP') return 'У этого сотрудника уже есть смена на это время.'
		if (error.code === 'DAY_OFF_SHIFT_CONFLICT') return 'Нельзя поставить выходной в день со сменой.'
		if (error.code === 'DAY_OFF_EXISTS') return 'На эту дату выходной уже назначен.'
		if (error.code === 'SCHEDULE_REVISION_REQUIRED') return 'Сначала создайте новую ревизию расписания.'
		if (error.code === 'DATE_OUTSIDE_SCHEDULE') return 'Дата должна входить в период расписания.'
		if (error.code === 'INVALID_DATE_RANGE') return 'Дата окончания периода должна быть не раньше даты начала.'
		if (error.code === 'INVALID_SHIFT_RANGE') return 'Время окончания должно быть позже времени начала.'
		if (error.code === 'NONEXISTENT_LOCAL_TIME' || error.code === 'AMBIGUOUS_LOCAL_TIME') return 'Такого однозначного местного времени нет из-за перевода часов.'
		if (error.status === 401) return 'Сессия завершилась. Войдите снова.'
		if (error.status === 403) return 'Недостаточно прав для изменения расписания.'
		if (error.status === 409) return 'Расписание изменилось. Обновите данные и повторите попытку.'
		if (error.status === 400) return 'Проверьте даты и время в форме.'
		if (error.status >= 500) return 'Сервис расписаний временно недоступен.'
	}
	return 'Не удалось выполнить операцию. Повторите попытку.'
}

function weekLabel(start: string): string {
	const end = shiftScheduleDate(start, 6)
	const startDate = new Date(`${start}T00:00:00Z`)
	const endDate = new Date(`${end}T00:00:00Z`)
	const sameMonth = startDate.getUTCMonth() === endDate.getUTCMonth() && startDate.getUTCFullYear() === endDate.getUTCFullYear()
	const left = dateLabel(start, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
	return `${left} — ${dateLabel(end, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export function SchedulesPage() {
	const initialDate = useMemo(() => scheduleDateInTimeZone(), [])
	const [weekStart, setWeekStart] = useState(() => scheduleWeekStart(initialDate))
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [employees, setEmployees] = useState<UserResponse[]>([])
	const [periods, setPeriods] = useState<SchedulePeriodResponse[]>([])
	const [selectedStore, setSelectedStore] = useState('')
	const [selected, setSelected] = useState<SchedulePeriodResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [showCreate, setShowCreate] = useState(false)
	const [showHistory, setShowHistory] = useState(false)
	const [createError, setCreateError] = useState<string | null>(null)
	const [createErrorField, setCreateErrorField] = useState<'storeId' | 'startDate' | 'endDate' | null>(null)
	const [entry, setEntry] = useState<EntryForm | null>(null)
	const [entryError, setEntryError] = useState<string | null>(null)
	const [entryErrorField, setEntryErrorField] = useState<EntryField | null>(null)
	const [createForm, setCreateForm] = useState({ storeId: '', startDate: scheduleWeekStart(initialDate), endDate: shiftScheduleDate(scheduleWeekStart(initialDate), 6) })
	const [history, setHistory] = useState<ScheduleHistoryResponse['data']>([])

	const loadReferenceData = useCallback(async () => {
		const [storeList, employeeList] = await Promise.all([
			managementFetch('/api/admin/stores?page=1&pageSize=100&isActive=true&sortBy=name&sortDirection=asc', storeListResponseSchema),
			managementFetch('/api/admin/employees?page=1&pageSize=100&role=staff&isActive=true&sortBy=lastName&sortDirection=asc', userListResponseSchema),
		])
		setStores(storeList.data)
		setEmployees(employeeList.data)
		setSelectedStore((current) => current || storeList.data[0]?.id || '')
		setCreateForm((current) => ({ ...current, storeId: current.storeId || storeList.data[0]?.id || '' }))
	}, [])

	const loadPeriods = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const query = new URLSearchParams({ page: '1', pageSize: '100', from: weekStart, to: shiftScheduleDate(weekStart, 6) })
			if (selectedStore) query.set('storeId', selectedStore)
			const response = await managementFetch(`/api/admin/schedules?${query}`, scheduleListResponseSchema)
			setPeriods(response.data)
			setSelected((current) => response.data.find((item) => item.id === current?.id) ?? response.data[0] ?? null)
		} catch (requestError) {
			if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login')
			else setError(errorText(requestError))
		} finally {
			setLoading(false)
		}
	}, [selectedStore, weekStart])

	useEffect(() => { void loadReferenceData().catch((requestError) => setError(errorText(requestError))) }, [loadReferenceData])
	useEffect(() => { void loadPeriods() }, [loadPeriods])
	useEffect(() => {
		if (!selected || !showHistory) return
		void managementFetch(`/api/admin/schedules/${selected.id}/history`, scheduleHistoryResponseSchema)
			.then((response) => setHistory(response.data))
			.catch(() => setHistory([]))
	}, [selected?.id, showHistory])

	const days = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftScheduleDate(weekStart, index)), [weekStart])
	const storeEmployees = useMemo(() => selected ? employees.filter((employee) => employee.storeIds.includes(selected.storeId)) : [], [employees, selected])

	function adoptPeriod(next: SchedulePeriodResponse) {
		setSelected(next)
		setPeriods((current) => {
			const found = current.some((item) => item.id === next.id)
			return found ? current.map((item) => item.id === next.id ? next : item) : [next, ...current].sort((left, right) => right.startDate.localeCompare(left.startDate))
		})
	}

	async function createSchedule(event: React.FormEvent) {
		event.preventDefault()
		setSaving(true)
		setCreateError(null)
		setCreateErrorField(null)
		const parsed = schedulePeriodCreateSchema.safeParse({ ...createForm, timezone: DEFAULT_SCHEDULE_TIME_ZONE })
		if (!parsed.success) {
			const field = parsed.error.issues[0]?.path[0]
			setCreateErrorField(field === 'storeId' || field === 'startDate' || field === 'endDate' ? field : null)
			setCreateError('Выберите магазин и проверьте даты периода.')
			setSaving(false)
			return
		}
		try {
			const created = await managementFetch('/api/admin/schedules', schedulePeriodResponseSchema, { method: 'POST', body: JSON.stringify(parsed.data) })
			adoptPeriod(created)
			setWeekStart(scheduleWeekStart(created.startDate))
			setShowCreate(false)
			toast.success('Черновик расписания создан')
		} catch (requestError) {
			setCreateError(errorText(requestError))
			if (requestError instanceof ManagementError && requestError.code === 'INVALID_DATE_RANGE') setCreateErrorField('endDate')
		} finally {
			setSaving(false)
		}
	}

	function openNewEntry(employee: UserResponse, localDate: string) {
		if (!selected || selected.status !== 'draft') return
		setEntryError(null)
		setEntryErrorField(null)
		setEntry({ kind: 'shift', id: null, employeeId: employee.id, employeeName: `${employee.firstName} ${employee.lastName}`, localDate, startTime: '09:00', endTime: '18:00', note: '' })
	}

	function editShift(shift: SchedulePeriodResponse['shifts'][number]) {
		setEntryError(null)
		setEntryErrorField(null)
		setEntry({ kind: 'shift', id: shift.id, employeeId: shift.employeeId, employeeName: shift.employeeName, localDate: shift.localDate, startTime: shift.startTime, endTime: shift.endTime, note: shift.note ?? '' })
	}

	function editDayOff(dayOff: SchedulePeriodResponse['daysOff'][number]) {
		setEntryError(null)
		setEntryErrorField(null)
		setEntry({ kind: 'day_off', id: dayOff.id, employeeId: dayOff.employeeId, employeeName: dayOff.employeeName, localDate: dayOff.localDate, startTime: '09:00', endTime: '18:00', note: dayOff.note ?? '' })
	}

	async function saveEntry(event: React.FormEvent) {
		event.preventDefault()
		if (!selected || !entry) return
		setSaving(true)
		setEntryError(null)
		setEntryErrorField(null)
		const note = entry.note.trim() || null
		try {
			let next: SchedulePeriodResponse
			if (entry.kind === 'shift') {
				const input = { localDate: entry.localDate, startTime: entry.startTime, endTime: entry.endTime, note }
				const parsed = entry.id
					? scheduleShiftUpdateSchema.safeParse(input)
					: scheduleShiftCreateSchema.safeParse({ ...input, employeeId: entry.employeeId })
				if (!parsed.success) {
					const field = parsed.error.issues[0]?.path[0]
					setEntryErrorField(field === 'localDate' || field === 'startTime' || field === 'endTime' ? field : null)
					throw new Error('FORM')
				}
				next = await managementFetch(`/api/admin/schedules/${selected.id}/shifts${entry.id ? `/${entry.id}` : ''}`, schedulePeriodResponseSchema, { method: entry.id ? 'PATCH' : 'POST', body: JSON.stringify(parsed.data) })
			} else {
				const input = { localDate: entry.localDate, note }
				const parsed = entry.id
					? scheduleDayOffUpdateSchema.safeParse(input)
					: scheduleDayOffCreateSchema.safeParse({ ...input, employeeId: entry.employeeId })
				if (!parsed.success) {
					const field = parsed.error.issues[0]?.path[0]
					setEntryErrorField(field === 'localDate' ? field : null)
					throw new Error('FORM')
				}
				next = await managementFetch(`/api/admin/schedules/${selected.id}/days-off${entry.id ? `/${entry.id}` : ''}`, schedulePeriodResponseSchema, { method: entry.id ? 'PATCH' : 'POST', body: JSON.stringify(parsed.data) })
			}
			adoptPeriod(next)
			setEntry(null)
			toast.success(entry.id ? 'Назначение изменено' : 'Назначение добавлено')
		} catch (requestError) {
			if (requestError instanceof Error && requestError.message === 'FORM') setEntryError('Проверьте дату и время назначения.')
			else {
				setEntryError(errorText(requestError))
				if (requestError instanceof ManagementError) {
					if (['DATE_OUTSIDE_SCHEDULE', 'DAY_OFF_EXISTS', 'DAY_OFF_SHIFT_CONFLICT'].includes(requestError.code)) setEntryErrorField('localDate')
					else if (['SHIFT_OVERLAP', 'INVALID_SHIFT_RANGE', 'NONEXISTENT_LOCAL_TIME', 'AMBIGUOUS_LOCAL_TIME'].includes(requestError.code)) setEntryErrorField('startTime')
				}
			}
		} finally {
			setSaving(false)
		}
	}

	async function removeEntry(kind: 'shift' | 'day_off', id: string) {
		if (!selected || selected.status !== 'draft') return
		const label = kind === 'shift' ? 'смену' : 'выходной'
		if (!window.confirm(`Удалить ${label}? Изменение сохранится в истории расписания.`)) return
		setSaving(true)
		try {
			const path = kind === 'shift' ? 'shifts' : 'days-off'
			const next = await managementFetch(`/api/admin/schedules/${selected.id}/${path}/${id}`, schedulePeriodResponseSchema, { method: 'DELETE' })
			adoptPeriod(next)
			toast.success(kind === 'shift' ? 'Смена удалена' : 'Выходной удалён')
		} catch (requestError) {
			toast.error(errorText(requestError))
		} finally {
			setSaving(false)
		}
	}

	async function changeStatus(action: 'publish' | 'revise') {
		if (!selected) return
		if (action === 'publish' && !window.confirm('Опубликовать расписание? Текущая опубликованная ревизия будет заменена новой.')) return
		setSaving(true)
		try {
			const next = await managementFetch(`/api/admin/schedules/${selected.id}/${action}`, schedulePeriodResponseSchema, { method: 'POST' })
			adoptPeriod(next)
			if (action === 'revise') toast.success('Создана новая ревизия расписания')
			else toast.success('Расписание опубликовано')
		} catch (requestError) {
			toast.error(errorText(requestError))
		} finally {
			setSaving(false)
		}
	}

	return <div>
		<div className="page-header">
			<div><div className="page-title">Расписание</div><div className="page-subtitle">Смены и выходные сотрудников по магазинам</div></div>
			<div className="page-header-actions"><Button variant="outline" onClick={() => void loadPeriods()} disabled={loading}><RefreshCw size={14} /> Обновить</Button><Button onClick={() => { setCreateError(null); setCreateErrorField(null); setCreateForm((current) => ({ ...current, storeId: selectedStore || current.storeId || stores[0]?.id || '', startDate: weekStart, endDate: shiftScheduleDate(weekStart, 6) })); setShowCreate(true) }}><Plus size={14} /> Новый период</Button></div>
		</div>

		<div className="toolbar schedule-toolbar">
			<select aria-label="Магазин" className="field-control field-select" value={selectedStore} onChange={(event) => { setSelectedStore(event.target.value); setSelected(null) }}><option value="">Все доступные магазины</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
			<div className="schedule-week-control"><Button variant="outline" size="sm" aria-label="Предыдущая неделя" onClick={() => setWeekStart((value) => shiftScheduleDate(value, -7))}><ChevronLeft size={15} /></Button><strong>{weekLabel(weekStart)}</strong><Button variant="outline" size="sm" aria-label="Следующая неделя" onClick={() => setWeekStart((value) => shiftScheduleDate(value, 7))}><ChevronRight size={15} /></Button><Button variant="outline" size="sm" onClick={() => { const current = scheduleDateInTimeZone(); setWeekStart(scheduleWeekStart(current)) }}>Сегодня</Button></div>
		</div>
		{error && <div className="showcase-banner" role="alert"><CalendarDays size={17} /><div><strong>Не удалось загрузить расписание</strong><p>{error}</p></div></div>}

		<div className="content-grid content-grid-wide schedule-layout">
			<section className="panel">
				<div className="panel-header"><div><h2>Периоды</h2><p>Опубликованные периоды меняются только через новую ревизию.</p></div></div>
				<div className="panel-content schedule-period-list">
					{loading ? <div className="empty-state"><LoaderCircle className="animate-spin" size={18} /><strong>Загрузка</strong></div> : periods.length === 0 ? <div className="empty-state"><CalendarDays size={22} /><strong>Периодов нет</strong><p>Создайте период для выбранного магазина.</p></div> : periods.map((period) => <button type="button" key={period.id} className={`schedule-period-row ${selected?.id === period.id ? 'schedule-period-row-active' : ''}`} aria-pressed={selected?.id === period.id} onClick={() => setSelected(period)}><span><strong>{period.storeName}</strong><small>{dateLabel(period.startDate)} — {dateLabel(period.endDate)} · ревизия {period.revision}</small></span><Badge tone={period.status === 'published' ? 'green' : 'orange'}>{period.status === 'published' ? 'Опубликовано' : 'Черновик'}</Badge></button>)}
				</div>
			</section>

			<section className="panel schedule-grid-panel">
				<div className="panel-header"><div><h2>{selected ? `${selected.storeName} · ${selected.status === 'published' ? 'опубликовано' : 'черновик'}` : 'Выберите период'}</h2><p>{selected ? `${dateLabel(selected.startDate)} — ${dateLabel(selected.endDate)} · ${selected.timezone}` : 'Сетка покажет сотрудников по дням недели.'}</p></div>{selected && <div className="panel-header-actions">{selected.status === 'published' ? <Button variant="outline" onClick={() => void changeStatus('revise')} disabled={saving}><RefreshCw size={14} /> Новая ревизия</Button> : <Button onClick={() => void changeStatus('publish')} disabled={saving}><Check size={14} /> Опубликовать</Button>}<Button variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}><History size={14} /> История</Button></div>}</div>
				{selected ? <div className="panel-content">
					<div className={`schedule-state-note ${selected.status}`} role="status"><Badge tone={selected.status === 'published' ? 'green' : 'orange'}>{selected.status === 'published' ? 'Опубликовано' : 'Черновик'}</Badge><span>{selected.status === 'draft' ? 'Изменения ещё не видны сотрудникам.' : 'Для изменений создайте новую ревизию.'}</span></div>
					<div className="schedule-calendar-scroll" role="region" aria-label="Недельная сетка расписания" tabIndex={0}>
						<table className="schedule-calendar"><thead><tr><th scope="col" className="schedule-employee-heading">Сотрудник</th>{days.map((day) => <th key={day} scope="col"><span>{weekdayLabel(day)}</span><small>{dateLabel(day, { day: 'numeric', month: 'short' })}</small></th>)}</tr></thead>
						<tbody>{storeEmployees.map((employee) => <tr key={employee.id}><th scope="row" className="schedule-employee-name">{employee.firstName} {employee.lastName}</th>{days.map((day) => {
							const inPeriod = day >= selected.startDate && day <= selected.endDate
							const shifts = selected.shifts.filter((item) => item.employeeId === employee.id && item.localDate === day)
							const dayOff = selected.daysOff.find((item) => item.employeeId === employee.id && item.localDate === day)
							return <td key={day} className={`schedule-calendar-cell ${inPeriod ? '' : 'outside-period'}`}>
								{shifts.map((shift) => <div className={`schedule-cell-entry shift ${selected.status}`} key={shift.id}><div><strong>{shift.startTime}–{shift.endTime}</strong>{shift.note && <small>{shift.note}</small>}</div>{selected.status === 'draft' && <span className="schedule-entry-actions"><button type="button" aria-label={`Изменить смену ${employee.firstName} ${employee.lastName}, ${dateLabel(day)}`} disabled={saving} onClick={() => editShift(shift)}><Pencil size={13} /></button><button type="button" aria-label={`Удалить смену ${employee.firstName} ${employee.lastName}, ${dateLabel(day)}`} disabled={saving} onClick={() => void removeEntry('shift', shift.id)}><Trash2 size={13} /></button></span>}</div>)}
								{dayOff && <div className={`schedule-cell-entry day-off ${selected.status}`}><div><strong>Выходной</strong>{dayOff.note && <small>{dayOff.note}</small>}</div>{selected.status === 'draft' && <span className="schedule-entry-actions"><button type="button" aria-label={`Изменить выходной ${employee.firstName} ${employee.lastName}, ${dateLabel(day)}`} disabled={saving} onClick={() => editDayOff(dayOff)}><Pencil size={13} /></button><button type="button" aria-label={`Удалить выходной ${employee.firstName} ${employee.lastName}, ${dateLabel(day)}`} disabled={saving} onClick={() => void removeEntry('day_off', dayOff.id)}><Trash2 size={13} /></button></span>}</div>}
								{!shifts.length && !dayOff && (selected.status === 'draft' && inPeriod ? <button type="button" className="schedule-cell-add" aria-label={`Добавить назначение: ${employee.firstName} ${employee.lastName}, ${dateLabel(day)}`} onClick={() => openNewEntry(employee, day)}><Plus size={14} /><span>Добавить</span></button> : <span className="schedule-cell-empty">{inPeriod ? 'Без назначения' : '—'}</span>)}
							</td>
						})}</tr>)}</tbody></table>
					</div>
					{storeEmployees.length === 0 && <div className="empty-state"><CalendarDays size={22} /><strong>Сотрудники не найдены</strong><p>В выбранном магазине нет активных сотрудников.</p></div>}
					<div className="schedule-legend"><span><i className="shift-mark" />Смена</span><span><i className="day-off-mark" />Выходной</span><span><i className="draft-mark" />Черновик</span></div>
					{showHistory && <div className="schedule-history-note"><strong>История изменений</strong>{history.length === 0 ? <p>Изменений пока нет.</p> : history.map((item) => <p key={item.id}>{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.action} · {item.actor ? `${item.actor.firstName} ${item.actor.lastName}` : 'система'}</p>)}</div>}
				</div> : <div className="empty-state"><CalendarDays size={24} /><strong>Нет выбранного периода</strong><p>Создайте период или выберите существующий для просмотра недельной сетки.</p></div>}
			</section>
		</div>

		{showCreate && <div className="dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false) }}><form className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="schedule-create-title" onSubmit={(event) => void createSchedule(event)}><div className="dialog-header"><strong id="schedule-create-title">Новый период</strong><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setShowCreate(false)}><X size={16} /></button></div><div className="dialog-body form-stack"><label>Магазин<select className="field-control field-select" aria-invalid={createErrorField === 'storeId'} required value={createForm.storeId} onChange={(event) => setCreateForm({ ...createForm, storeId: event.target.value })}><option value="">Выберите магазин</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>Начало<Input aria-label="Начало периода" aria-invalid={createErrorField === 'startDate'} type="date" required value={createForm.startDate} onChange={(event) => setCreateForm({ ...createForm, startDate: event.target.value })} /></label><label>Конец<Input aria-label="Конец периода" aria-invalid={createErrorField === 'endDate'} type="date" required value={createForm.endDate} onChange={(event) => setCreateForm({ ...createForm, endDate: event.target.value })} />{createErrorField === 'endDate' && createError && <span className="field-error" role="alert">{createError}</span>}</label>{createError && !createErrorField && <p className="field-error" role="alert">{createError}</p>}<div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Отмена</Button><Button type="submit" disabled={saving || stores.length === 0}>{saving && <LoaderCircle className="animate-spin" size={14} />} Создать черновик</Button></div></div></form></div>}

		{entry && <div className="dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEntry(null) }}><form className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="schedule-entry-title" onSubmit={(event) => void saveEntry(event)}><div className="dialog-header"><strong id="schedule-entry-title">{entry.id ? 'Изменить назначение' : 'Новое назначение'}</strong><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setEntry(null)}><X size={16} /></button></div><div className="dialog-body form-stack"><p className="role-note">{entry.employeeName} · {selected?.storeName}</p>{!entry.id && <label>Тип назначения<select className="field-control field-select" value={entry.kind} onChange={(event) => setEntry({ ...entry, kind: event.target.value as EntryForm['kind'] })}><option value="shift">Смена</option><option value="day_off">Выходной</option></select></label>}<label>Дата<Input aria-label="Дата назначения" aria-invalid={entryErrorField === 'localDate'} type="date" required min={selected?.startDate} max={selected?.endDate} value={entry.localDate} onChange={(event) => setEntry({ ...entry, localDate: event.target.value })} />{entryErrorField === 'localDate' && entryError && <span className="field-error" role="alert">{entryError}</span>}</label>{entry.kind === 'shift' && <><label>Начало<Input aria-label="Начало смены" aria-invalid={entryErrorField === 'startTime'} type="time" required value={entry.startTime} onChange={(event) => setEntry({ ...entry, startTime: event.target.value })} />{entryErrorField === 'startTime' && entryError && <span className="field-error" role="alert">{entryError}</span>}</label><label>Конец<Input aria-label="Конец смены" aria-invalid={entryErrorField === 'endTime'} type="time" required value={entry.endTime} onChange={(event) => setEntry({ ...entry, endTime: event.target.value })} />{entryErrorField === 'endTime' && entryError && <span className="field-error" role="alert">{entryError}</span>}</label></>}<label>Заметка<Input aria-label="Заметка" maxLength={1000} value={entry.note} onChange={(event) => setEntry({ ...entry, note: event.target.value })} /></label>{entryError && !entryErrorField && <p className="field-error" role="alert">{entryError}</p>}<div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setEntry(null)}>Отмена</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="animate-spin" size={14} />} Сохранить</Button></div></div></form></div>}
	</div>
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ClipboardCheck, Clock3, ListChecks, LoaderCircle, Plus, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import {
	taskCreateSchema,
	taskListResponseSchema,
	taskResponseSchema,
	taskReviewHistoryResponseSchema,
	taskReviewListResponseSchema,
	taskReviewSchema,
	taskTemplateCreateSchema,
	taskTemplateListResponseSchema,
	taskTemplateResponseSchema,
	storeListResponseSchema,
	userListResponseSchema,
	type TaskResponse,
	type StoreResponse,
	type UserResponse,
} from '@vizaje/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ManagementError, managementFetch } from '@/lib/management-client'

const statusLabels: Record<TaskResponse['status'], string> = { assigned: 'Назначено', in_progress: 'В работе', submitted: 'На проверке', checked: 'Проверено', rejected: 'Отклонено' }
const priorityLabels = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', urgent: 'Срочный' } as const

function errorText(error: unknown): string {
	if (error instanceof ManagementError) {
		if (error.code === 'STORE_FORBIDDEN') return 'Магазин находится вне зоны доступа'
		if (error.code === 'TASK_VERSION_CONFLICT') return 'Задание уже изменено, обновите данные'
		if (error.status === 403) return 'Недостаточно прав'
		if (error.status >= 500) return 'Сервис заданий временно недоступен'
	}
	return 'Не удалось выполнить операцию'
}

function dateLabel(value: string | null): string { return value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Без срока' }

export function TasksPage() {
	const [tasks, setTasks] = useState<TaskResponse[]>([])
	const [reviews, setReviews] = useState<TaskResponse[]>([])
	const [templates, setTemplates] = useState<Awaited<ReturnType<typeof loadTemplates>>>([])
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [employees, setEmployees] = useState<UserResponse[]>([])
	const [selected, setSelected] = useState<TaskResponse | null>(null)
	const [history, setHistory] = useState<Array<{ id: string; action: string; comment: string | null; createdAt: string }>>([])
	const [storeId, setStoreId] = useState('')
	const [status, setStatus] = useState('')
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [showCreate, setShowCreate] = useState(false)
	const [showTemplate, setShowTemplate] = useState(false)
	const [createForm, setCreateForm] = useState({ title: '', category: 'Розничная работа', priority: 'normal', storeId: '', employeeId: '', dueAt: '', requiresReview: true, requiresPhoto: false, checklist: '' })
	const [templateForm, setTemplateForm] = useState({ title: '', category: 'Розничная работа', defaultPriority: 'normal', checklist: '' })

	async function loadTemplates() { const response = await managementFetch('/api/admin/task-templates?page=1&pageSize=100&active=true', taskTemplateListResponseSchema); return response.data }

	const load = useCallback(async () => {
		setLoading(true); setError(null)
		try {
			const query = new URLSearchParams({ page: '1', pageSize: '100' }); if (storeId) query.set('storeId', storeId); if (status) query.set('status', status)
			const [taskResponse, reviewResponse, storeResponse, employeeResponse, templateResponse] = await Promise.all([
				managementFetch(`/api/admin/tasks?${query}`, taskListResponseSchema),
				managementFetch(`/api/admin/task-reviews?page=1&pageSize=100${storeId ? `&storeId=${storeId}` : ''}`, taskReviewListResponseSchema),
				managementFetch('/api/admin/stores?page=1&pageSize=100&isActive=true&sortBy=name&sortDirection=asc', storeListResponseSchema),
				managementFetch('/api/admin/employees?page=1&pageSize=100&role=staff&isActive=true&sortBy=lastName&sortDirection=asc', userListResponseSchema),
				loadTemplates(),
			])
			setTasks(taskResponse.data); setReviews(reviewResponse.data); setStores(storeResponse.data); setEmployees(employeeResponse.data); setTemplates(templateResponse)
			setSelected((value) => value ? taskResponse.data.find((item) => item.id === value.id) ?? value : taskResponse.data[0] ?? null)
		} catch (requestError) { setError(requestError instanceof ManagementError && requestError.status === 401 ? 'Сеанс истёк' : errorText(requestError)) } finally { setLoading(false) }
	}, [status, storeId])

	useEffect(() => { void load() }, [load])
	useEffect(() => { if (!selected) return; void managementFetch(`/api/admin/tasks/${selected.id}/history`, taskReviewHistoryResponseSchema).then((response) => setHistory(response.data)).catch(() => setHistory([])) }, [selected])

	const eligibleEmployees = useMemo(() => employees.filter((employee) => !createForm.storeId || employee.storeIds.includes(createForm.storeId)), [createForm.storeId, employees])

	async function createTask(event: React.FormEvent) {
		event.preventDefault(); setSaving(true)
		try {
			const checklist = createForm.checklist.split('\n').map((label) => label.trim()).filter(Boolean).map((label) => ({ label, isRequired: true, requiresEvidence: false }))
			const parsed = taskCreateSchema.safeParse({ title: createForm.title, category: createForm.category, priority: createForm.priority, storeIds: [createForm.storeId], employeeIds: [createForm.employeeId], dueAt: createForm.dueAt ? new Date(createForm.dueAt).toISOString() : null, timezone: 'Europe/Chisinau', requiresReview: createForm.requiresReview, requiresPhoto: createForm.requiresPhoto, checklist })
			if (!parsed.success) throw new Error('FORM')
			const created = await managementFetch('/api/admin/tasks', taskResponseSchema, { method: 'POST', body: JSON.stringify(parsed.data) })
			setSelected(created); setShowCreate(false); setCreateForm((value) => ({ ...value, title: '', employeeId: '', dueAt: '', checklist: '' })); await load(); toast.success('Задание назначено')
		} catch (requestError) { toast.error(requestError instanceof Error && requestError.message === 'FORM' ? 'Заполните название, магазин и сотрудника' : errorText(requestError)) } finally { setSaving(false) }
	}

	async function createTemplate(event: React.FormEvent) {
		event.preventDefault(); setSaving(true)
		try {
			const checklist = templateForm.checklist.split('\n').map((label) => label.trim()).filter(Boolean).map((label) => ({ label, isRequired: true, requiresEvidence: false }))
			const parsed = taskTemplateCreateSchema.safeParse({ title: templateForm.title, category: templateForm.category, defaultPriority: templateForm.defaultPriority, checklist, requiresReview: true, requiresPhoto: false, active: true })
			if (!parsed.success) throw new Error('FORM')
			await managementFetch('/api/admin/task-templates', taskTemplateResponseSchema, { method: 'POST', body: JSON.stringify(parsed.data) }); setShowTemplate(false); setTemplateForm({ title: '', category: 'Розничная работа', defaultPriority: 'normal', checklist: '' }); await load(); toast.success('Шаблон создан')
		} catch (requestError) { toast.error(requestError instanceof Error && requestError.message === 'FORM' ? 'Укажите название шаблона' : errorText(requestError)) } finally { setSaving(false) }
	}

	async function review(action: 'check' | 'reject') {
		if (!selected?.latestSubmission) return
		const comment = action === 'reject' ? window.prompt('Причина отклонения')?.trim() ?? '' : window.prompt('Комментарий (необязательно)')?.trim() ?? ''
		const parsed = taskReviewSchema.safeParse({ expectedVersion: selected.version, comment: comment || null })
		if (!parsed.success || (action === 'reject' && !comment)) { if (action === 'reject') toast.error('Для отклонения нужна причина'); return }
		setSaving(true)
		try { const next = await managementFetch(`/api/admin/task-reviews/${selected.latestSubmission.id}/${action}`, taskResponseSchema, { method: 'POST', body: JSON.stringify(parsed.data) }); setSelected(next); await load(); toast.success(action === 'check' ? 'Задание проверено' : 'Задание отклонено') } catch (requestError) { toast.error(errorText(requestError)) } finally { setSaving(false) }
	}

	return <div>
		<div className="page-header"><div><div className="page-title">Задания</div><div className="page-subtitle">Чеклисты, сроки и проверка выполнения по магазинам</div></div><div className="page-header-actions"><Button variant="outline" onClick={() => void load()}><RefreshCw size={14} /> Обновить</Button><Button variant="outline" onClick={() => setShowTemplate(true)}><ListChecks size={14} /> Новый шаблон</Button><Button onClick={() => setShowCreate(true)}><Plus size={14} /> Новое задание</Button></div></div>
		<div className="toolbar"><select aria-label="Магазин" className="field-control field-select" value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="">Все магазины</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select><select aria-label="Статус" className="field-control field-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Все статусы</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="text-muted-foreground">На проверке: {reviews.length}</span></div>
		{templates.length > 0 && <section className="panel mb-4"><div className="panel-header"><div><h2>Шаблоны</h2><p>Новые задания сохраняют снимок выбранной версии.</p></div></div><div className="panel-content schedule-period-list">{templates.map((template) => <div className="schedule-period-row" key={template.id}><span><strong>{template.title}</strong><small>{template.category} · версия {template.version} · {template.checklist.length} пунктов</small></span><span className="text-muted-foreground">{priorityLabels[template.defaultPriority]}</span></div>)}</div></section>}
		{error && <div className="showcase-banner"><ClipboardCheck size={17} /><div><strong>Не удалось загрузить задания</strong><p>{error}</p></div></div>}
		<div className="content-grid content-grid-wide"><section className="panel"><div className="panel-header"><div><h2>Список заданий</h2><p>Данные загружены из API с учётом прав доступа.</p></div></div><div className="panel-content schedule-period-list">{loading ? <div className="empty-state"><LoaderCircle className="animate-spin" size={18} /><strong>Загрузка</strong></div> : tasks.length === 0 ? <div className="empty-state"><ClipboardCheck size={22} /><strong>Заданий нет</strong><p>Назначьте первое задание сотруднику.</p></div> : tasks.map((task) => <button type="button" key={task.id} className={`schedule-period-row ${selected?.id === task.id ? 'schedule-period-row-active' : ''}`} onClick={() => setSelected(task)}><span><strong>{task.title}</strong><small>{task.storeName} · {task.assignedEmployeeName} · {dateLabel(task.dueAt)}</small></span><Badge tone={task.status === 'checked' ? 'green' : task.status === 'rejected' ? 'danger' : task.status === 'submitted' ? 'orange' : 'blue'}>{statusLabels[task.status]}</Badge></button>)}</div></section>
		<section className="panel">{selected ? <><div className="panel-header"><div><h2>{selected.title}</h2><p>{selected.storeName} · {selected.assignedEmployeeName} · {priorityLabels[selected.priority]}</p></div><Badge tone={selected.overdue ? 'danger' : selected.status === 'checked' ? 'green' : 'orange'}>{selected.overdue ? 'Просрочено' : statusLabels[selected.status]}</Badge></div><div className="panel-content"><p className="text-muted-foreground">{selected.description || 'Описание не добавлено.'}</p><p><Clock3 size={14} className="mr-1 inline" /> Срок: {dateLabel(selected.dueAt)} · часовой пояс {selected.timezone}</p><div className="form-stack"><strong>Чеклист</strong>{selected.checklist.length === 0 ? <p className="text-muted-foreground">Пунктов нет.</p> : selected.checklist.map((item) => <div className="schedule-day-off" key={item.id}><span>{item.completed ? '✓' : '○'} {item.label}{item.isRequired ? ' · обязательно' : ''}</span></div>)}</div>{selected.evidence.length > 0 && <div className="form-stack"><strong>Фото доказательства</strong><div className="task-evidence-grid">{selected.evidence.map((item) => <img key={item.id} src={`/api/admin/task-evidence/${item.id}`} alt={item.originalFilename} loading="lazy" className="task-evidence-image" />)}</div></div>}{selected.latestSubmission && <div className="showcase-banner"><ClipboardCheck size={16} /><div><strong>Отправка {selected.latestSubmission.submissionVersion}</strong><p>{selected.latestSubmission.completionNote || 'Комментарий сотрудника не добавлен.'}</p></div></div>}{selected.status === 'submitted' && <div className="dialog-actions"><Button onClick={() => void review('check')} disabled={saving}><Check size={14} /> Проверить</Button><Button variant="outline" onClick={() => void review('reject')} disabled={saving}><X size={14} /> Отклонить</Button></div>}<div className="form-stack"><strong>История</strong>{history.length === 0 ? <p className="text-muted-foreground">История пока пуста.</p> : history.map((item) => <p key={item.id} className="text-muted-foreground">{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.action}{item.comment ? ` · ${item.comment}` : ''}</p>)}</div></div></> : <div className="empty-state"><ClipboardCheck size={24} /><strong>Выберите задание</strong><p>Здесь появятся чеклист и история проверки.</p></div>}</section></div>
		{showCreate && <div className="dialog-layer" role="dialog" aria-modal="true"><form className="dialog-panel" onSubmit={createTask}><div className="dialog-header"><strong>Новое задание</strong><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setShowCreate(false)}>×</button></div><div className="dialog-body form-stack"><label>Название<Input required value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} /></label><label>Категория<Input required value={createForm.category} onChange={(event) => setCreateForm({ ...createForm, category: event.target.value })} /></label><label>Магазин<select className="field-control field-select" required value={createForm.storeId} onChange={(event) => setCreateForm({ ...createForm, storeId: event.target.value, employeeId: '' })}><option value="">Выберите магазин</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>Сотрудник<select className="field-control field-select" required value={createForm.employeeId} onChange={(event) => setCreateForm({ ...createForm, employeeId: event.target.value })}><option value="">Выберите сотрудника</option>{eligibleEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label><label>Приоритет<select className="field-control field-select" value={createForm.priority} onChange={(event) => setCreateForm({ ...createForm, priority: event.target.value })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Срок<Input type="datetime-local" value={createForm.dueAt} onChange={(event) => setCreateForm({ ...createForm, dueAt: event.target.value })} /></label><label>Пункты чеклиста<textarea className="field-control" rows={4} placeholder="Один пункт на строку" value={createForm.checklist} onChange={(event) => setCreateForm({ ...createForm, checklist: event.target.value })} /></label><label className="checkbox-row"><input type="checkbox" checked={createForm.requiresReview} onChange={(event) => setCreateForm({ ...createForm, requiresReview: event.target.checked })} /> Нужна проверка менеджера</label><label className="checkbox-row"><input type="checkbox" checked={createForm.requiresPhoto} onChange={(event) => setCreateForm({ ...createForm, requiresPhoto: event.target.checked })} /> Требуется фото</label><div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Отмена</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="animate-spin" size={14} />} Назначить</Button></div></div></form></div>}
		{showTemplate && <div className="dialog-layer" role="dialog" aria-modal="true"><form className="dialog-panel" onSubmit={createTemplate}><div className="dialog-header"><strong>Новый шаблон</strong><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setShowTemplate(false)}>×</button></div><div className="dialog-body form-stack"><label>Название<Input required value={templateForm.title} onChange={(event) => setTemplateForm({ ...templateForm, title: event.target.value })} /></label><label>Категория<Input required value={templateForm.category} onChange={(event) => setTemplateForm({ ...templateForm, category: event.target.value })} /></label><label>Приоритет по умолчанию<select className="field-control field-select" value={templateForm.defaultPriority} onChange={(event) => setTemplateForm({ ...templateForm, defaultPriority: event.target.value })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Пункты чеклиста<textarea className="field-control" rows={4} placeholder="Один пункт на строку" value={templateForm.checklist} onChange={(event) => setTemplateForm({ ...templateForm, checklist: event.target.value })} /></label><div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setShowTemplate(false)}>Отмена</Button><Button type="submit" disabled={saving}><Plus size={14} /> Создать шаблон</Button></div></div></form></div>}
	</div>
}

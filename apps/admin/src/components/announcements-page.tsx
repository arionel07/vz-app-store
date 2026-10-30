'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellRing, Check, Edit3, LoaderCircle, Megaphone, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { announcementCreateSchema, announcementListResponseSchema, announcementResponseSchema, storeListResponseSchema, type AnnouncementResponse, type StoreResponse } from '@vizaje/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useSessionUser } from '@/components/session-provider'
import { ManagementError, managementFetch } from '@/lib/management-client'

const PAGE_SIZE = 20
const statusLabels = { draft: 'Черновик', published: 'Опубликовано', archived: 'Архив' } as const

type FormState = { title: string; body: string; storeIds: string[]; roles: ('staff' | 'manager')[]; requiresAcknowledgement: boolean }

function emptyForm(): FormState { return { title: '', body: '', storeIds: [], roles: ['staff'], requiresAcknowledgement: false } }
function errorText(error: unknown): string { if (error instanceof ManagementError && error.status === 403) return 'Недостаточно прав или магазин вне вашей области'; if (error instanceof ManagementError && error.status >= 500) return 'Сервис уведомлений временно недоступен'; return 'Не удалось выполнить операцию' }

export function AnnouncementsPage() {
	const user = useSessionUser()
	const [items, setItems] = useState<AnnouncementResponse[]>([])
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [status, setStatus] = useState<'all' | 'draft' | 'published' | 'archived'>('all')
	const [selected, setSelected] = useState<AnnouncementResponse | null>(null)
	const [dialog, setDialog] = useState(false)
	const [form, setForm] = useState<FormState>(emptyForm)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true); setError(null)
		try {
			const query = new URLSearchParams({ page: '1', pageSize: String(PAGE_SIZE) }); if (status !== 'all') query.set('status', status)
			const [announcements, storeList] = await Promise.all([
				managementFetch(`/api/admin/announcements?${query}`, announcementListResponseSchema),
				managementFetch('/api/admin/stores?page=1&pageSize=100&isActive=true&sortBy=name&sortDirection=asc', storeListResponseSchema),
			])
			setItems(announcements.data); setStores(storeList.data); setSelected((current) => current ? announcements.data.find((item) => item.id === current.id) ?? current : announcements.data[0] ?? null)
		} catch (requestError) { if (requestError instanceof ManagementError && requestError.status === 401) window.location.replace('/login'); else setError(errorText(requestError)) } finally { setLoading(false) }
	}, [status])

	useEffect(() => { void load() }, [load])

	function openCreate() { setSelected(null); setForm(emptyForm()); setDialog(true) }
	function openEdit(item: AnnouncementResponse) { if (item.status !== 'draft') return; setSelected(item); setForm({ title: item.title, body: item.body, storeIds: item.storeIds, roles: item.roles.filter((role): role is 'staff' | 'manager' => role === 'staff' || role === 'manager'), requiresAcknowledgement: item.requiresAcknowledgement }); setDialog(true) }
	function toggleStore(id: string) { setForm((current) => ({ ...current, storeIds: current.storeIds.includes(id) ? current.storeIds.filter((value) => value !== id) : [...current.storeIds, id] })) }
	function toggleRole(role: 'staff' | 'manager') { setForm((current) => ({ ...current, roles: current.roles.includes(role) ? current.roles.filter((value) => value !== role) : [...current.roles, role] })) }

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault(); setSaving(true)
		try {
			const parsed = announcementCreateSchema.safeParse(form); if (!parsed.success) throw new Error('FORM')
			const next = selected ? await managementFetch(`/api/admin/announcements/${selected.id}`, announcementResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed.data) }) : await managementFetch('/api/admin/announcements', announcementResponseSchema, { method: 'POST', body: JSON.stringify(parsed.data) })
			setSelected(next); setDialog(false); await load(); toast.success(selected ? 'Черновик обновлён' : 'Черновик создан')
		} catch (requestError) { toast.error(requestError instanceof Error && requestError.message === 'FORM' ? 'Заполните заголовок, текст и получателей' : errorText(requestError)) } finally { setSaving(false) }
	}

	async function publish() {
		if (!selected || selected.status !== 'draft' || !window.confirm('Опубликовать объявление? Получатели сразу увидят его в приложении.')) return
		setSaving(true); try { const next = await managementFetch(`/api/admin/announcements/${selected.id}/publish`, announcementResponseSchema, { method: 'POST' }); setSelected(next); await load(); toast.success('Объявление опубликовано') } catch (requestError) { toast.error(errorText(requestError)) } finally { setSaving(false) }
	}

	return <div className="management-page">
		<header className="management-toolbar"><div><p className="eyebrow">Рабочая область</p><h1 className="page-title">Объявления</h1><p className="page-subtitle">Внутренние сообщения с безопасным выбором магазинов и ролей</p></div><div className="management-toolbar-actions"><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Обновить</Button><Button size="sm" onClick={openCreate}><Plus size={14} />Новое объявление</Button></div></header>
		<div className="management-filters"><label className="sr-only" htmlFor="announcement-status">Статус</label><Select id="announcement-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Все статусы</option><option value="draft">Черновики</option><option value="published">Опубликованные</option><option value="archived">Архив</option></Select><div className="flex items-center justify-end text-xs text-muted-foreground">{user.role === 'admin' ? 'Доступ администратора' : 'Только ваша область магазинов'}</div></div>
		{error && <div className="management-error" role="alert">{error}<button type="button" onClick={() => void load()}>Повторить</button></div>}
		<div className="management-grid mt-3"><section className="management-surface" aria-label="Список объявлений">{loading ? <div className="management-state"><LoaderCircle className="mx-auto animate-spin" /><p>Загружаем объявления…</p></div> : items.length === 0 ? <div className="management-state"><Megaphone className="mx-auto text-muted-foreground" /><strong>Объявлений нет</strong><p>Создайте первое сообщение для сотрудников.</p></div> : <table className="management-table"><thead><tr><th>Сообщение</th><th>Статус</th><th>Получатели</th><th>Изменено</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id} aria-selected={selected?.id === item.id} onClick={() => setSelected(item)}><td><div className="employee-name-cell"><span className="store-symbol"><Megaphone size={15} /></span><div><strong>{item.title}</strong><small>{item.body.slice(0, 90)}{item.body.length > 90 ? '…' : ''}</small></div></div></td><td><Badge tone={item.status === 'published' ? 'green' : item.status === 'archived' ? 'danger' : 'blue'}>{statusLabels[item.status]}</Badge></td><td>{item.metrics.recipientCount}</td><td className="cell-muted">{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td><td className="actions-cell">{item.status === 'draft' && <button type="button" className="row-more" aria-label={`Изменить ${item.title}`} onClick={(event) => { event.stopPropagation(); openEdit(item) }}><Edit3 size={15} /></button>}</td></tr>)}</tbody></table>}</section>
			<aside className="management-surface management-inspector" aria-label="Карточка объявления">{!selected ? <div className="management-state"><Megaphone className="mx-auto text-muted-foreground" /><p>Выберите объявление.</p></div> : <><div className="panel-header"><div><p className="eyebrow">Карточка</p><h2 className="panel-title">{selected.title}</h2><p className="panel-description">{statusLabels[selected.status]}</p></div>{selected.status === 'draft' && <Button variant="ghost" size="icon-sm" aria-label="Редактировать" onClick={() => openEdit(selected)}><Edit3 /></Button>}</div><div className="panel-content"><p className="whitespace-pre-wrap text-sm leading-6">{selected.body}</p><dl className="management-meta"><div><dt>Роли</dt><dd>{selected.roles.map((role) => role === 'staff' ? 'Сотрудники' : 'Менеджеры').join(', ')}</dd></div><div><dt>Магазины</dt><dd>{selected.storeIds.length ? `${selected.storeIds.length} выбрано` : 'Все доступные магазины'}</dd></div><div><dt>Прочитали</dt><dd>{selected.metrics.readCount} из {selected.metrics.recipientCount}</dd></div><div><dt>Подтвердили</dt><dd>{selected.metrics.acknowledgedCount}</dd></div></dl><div className="management-actions">{selected.status === 'draft' && <Button disabled={saving} onClick={() => void publish()}><Check size={14} />Опубликовать</Button>}{selected.requiresAcknowledgement && <span className="role-note"><BellRing size={14} /> Требуется подтверждение</span>}</div></div></>}</aside>
		</div>
		{dialog && <div className="dialog-layer" role="dialog" aria-modal="true"><form className="dialog-panel" onSubmit={save}><div className="dialog-header"><strong>{selected ? 'Изменить черновик' : 'Новое объявление'}</strong><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setDialog(false)}>×</button></div><div className="dialog-body form-stack"><label>Заголовок<Input autoFocus required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Текст<textarea className="field-control min-h-32" required value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></label><fieldset><legend className="form-label">Роли получателей</legend><div className="flex gap-4"><label className="store-check"><input type="checkbox" checked={form.roles.includes('staff')} onChange={() => toggleRole('staff')} /> Сотрудники</label>{user.role === 'admin' && <label className="store-check"><input type="checkbox" checked={form.roles.includes('manager')} onChange={() => toggleRole('manager')} /> Менеджеры</label>}</div></fieldset><fieldset><legend className="form-label">Магазины</legend><div className="max-h-40 overflow-auto">{stores.map((store) => <label className="store-check" key={store.id}><input type="checkbox" checked={form.storeIds.includes(store.id)} onChange={() => toggleStore(store.id)} /> {store.name}</label>)}</div><p className="role-note">Для менеджера выбор магазина обязателен. Пустой список для администратора означает все магазины.</p></fieldset><label className="store-check"><input type="checkbox" checked={form.requiresAcknowledgement} onChange={(event) => setForm({ ...form, requiresAcknowledgement: event.target.checked })} /> Требовать подтверждение прочтения</label><div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setDialog(false)}>Отмена</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="animate-spin" size={14} />} Сохранить черновик</Button></div></div></form></div>}
	</div>
}

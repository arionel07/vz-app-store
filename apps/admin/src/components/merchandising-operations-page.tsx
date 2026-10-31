'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, LoaderCircle, Pencil, Plus, Power, X } from 'lucide-react'
import { photoListResponseSchema, type CampaignResponse, type InspectionResponse, type MerchandisingDisplayCreate, type MerchandisingDisplayUpdate, type PhotoResponse } from '@vizaje/contracts'
import { useSessionUser } from '@/components/session-provider'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { managementFetch } from '@/lib/management-client'
import { operationEvidenceUrl, operationsApi } from '@/lib/operations-client'
import { activateTableRow, dateLabel, EmptyState, ErrorNotice, historyText, LoadingState, PAGE_SIZE, PageHeader, Pagination, StatusBadge, useOperationCatalog } from '@/components/operations-common'

type DisplayForm = { storeId: string; name: string; brand: string; referencePhotoId: string; checklist: string; campaignId: string; active: boolean }
const initialForm: DisplayForm = { storeId: '', name: '', brand: '', referencePhotoId: '', checklist: '', campaignId: '', active: true }

export function MerchandisingOperationsPage() {
	const user = useSessionUser()
	const canReview = user.role === 'admin' || user.role === 'manager'
	const catalog = useOperationCatalog()
	const [items, setItems] = useState<InspectionResponse[]>([])
	const [selected, setSelected] = useState<InspectionResponse | null>(null)
	const [history, setHistory] = useState<Array<{ id: string; inspectionId: string; actorId: string; fromStatus: string; toStatus: string; comment: string | null; createdAt: string }>>([])
	const [photos, setPhotos] = useState<PhotoResponse[]>([])
	const [campaigns, setCampaigns] = useState<CampaignResponse[]>([])
	const [form, setForm] = useState<DisplayForm>(initialForm)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [reviewComment, setReviewComment] = useState('')
	const [storeId, setStoreId] = useState('')
	const [status, setStatus] = useState('')
	const [activeFilter, setActiveFilter] = useState('active')
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [photoLoading, setPhotoLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true); setError(null)
		try {
			const response = await operationsApi.merchandising.list({ page, pageSize: PAGE_SIZE, storeId: storeId || undefined, status: status || undefined, active: activeFilter === 'all' ? undefined : activeFilter === 'active' })
			setItems(response.data); setPagination(response.pagination)
			if (selected && !response.data.some((item) => item.id === selected.id)) setSelected(null)
			return response.data
		} catch { setError('Не удалось загрузить выкладку и проверки. Проверьте соединение и права доступа.'); return null } finally { setLoading(false) }
	}, [activeFilter, page, selected, status, storeId])
	useEffect(() => { void load() }, [load])

	useEffect(() => {
		if (!dialogOpen || !form.storeId) { setPhotos([]); return }
		let cancelled = false
		setPhotoLoading(true)
		managementFetch(`/api/admin/photos?page=1&pageSize=100&storeId=${form.storeId}`, photoListResponseSchema)
			.then((result) => { if (!cancelled) setPhotos(result.data) })
			.catch(() => { if (!cancelled) setPhotos([]) })
			.finally(() => { if (!cancelled) setPhotoLoading(false) })
		return () => { cancelled = true }
	}, [dialogOpen, form.storeId])

	useEffect(() => {
		let cancelled = false
		operationsApi.campaigns.list({ page: 1, pageSize: 100 }).then((result) => { if (!cancelled) setCampaigns(result.data.filter((campaign) => ['scheduled', 'active'].includes(campaign.status))) }).catch(() => { if (!cancelled) setCampaigns([]) })
		return () => { cancelled = true }
	}, [])

	const refreshDetails = useCallback(async (row: InspectionResponse) => {
		setSelected(row)
		if (row.status === 'draft') { setHistory([]); return }
		try { const result = await operationsApi.merchandising.history(row.id); setHistory(result.data) } catch { setNotice('Не удалось загрузить историю проверки.') }
	}, [])

	function openCreate() { setEditingId(null); setForm({ ...initialForm, storeId: storeId || (catalog.stores.length === 1 ? catalog.stores[0]!.id : '') }); setDialogOpen(true); setNotice(null) }
	function openEdit(row: InspectionResponse) {
		const current = row.currentDisplay
		setEditingId(row.displayId)
		setForm({ storeId: row.storeId, name: current?.name ?? row.displayName, brand: current?.brand ?? row.brand, referencePhotoId: current?.referencePhotoId ?? row.referencePhotoId, checklist: (current?.checklist ?? row.checklist).join('\n'), campaignId: '', active: current?.active ?? row.active ?? true })
		setDialogOpen(true); setNotice(null)
	}
	async function saveDisplay(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); if (saving) return
		setSaving(true); setNotice(null)
		try {
			let updatedDisplayId: string | null = null
			if (editingId) {
				const payload: MerchandisingDisplayUpdate = { name: form.name.trim(), brand: form.brand.trim(), referencePhotoId: form.referencePhotoId, checklist: form.checklist.split('\n').map((line) => line.trim()).filter(Boolean), active: form.active }
				const updated = await operationsApi.merchandising.updateDisplay(editingId, payload)
				updatedDisplayId = updated.id
			} else {
				const payload: MerchandisingDisplayCreate = { storeId: form.storeId, name: form.name.trim(), brand: form.brand.trim(), referencePhotoId: form.referencePhotoId, checklist: form.checklist.split('\n').map((line) => line.trim()).filter(Boolean), campaignId: form.campaignId || null }
				const created = await operationsApi.merchandising.createDisplay(payload)
				updatedDisplayId = created.id
			}
			setDialogOpen(false)
			const refreshedRows = await load()
			const refreshed = refreshedRows?.find((row) => row.displayId === updatedDisplayId)
			if (refreshed) setSelected(refreshed)
			setNotice(editingId ? 'Параметры выкладки сохранены.' : 'Стенд добавлен.')
		} catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Не удалось сохранить стенд.'); if (reason instanceof Error && 'status' in reason && reason.status === 409) { const refreshedRows = await load(); const refreshed = refreshedRows?.find((row) => row.displayId === editingId); if (refreshed) setSelected(refreshed) } } finally { setSaving(false) }
	}
	async function toggleActive(row: InspectionResponse) {
		const active = row.currentDisplay?.active ?? row.active ?? true
		if (!window.confirm(active ? `Отключить стенд «${row.currentDisplay?.name ?? row.displayName}»?` : `Включить стенд «${row.currentDisplay?.name ?? row.displayName}»?`)) return
		setSaving(true)
		try { const updated = await operationsApi.merchandising.updateDisplay(row.displayId, { active: !active }); setSelected((current) => current?.displayId === row.displayId ? { ...current, active: updated.active, currentDisplay: { name: updated.name, brand: updated.brand, referencePhotoId: updated.referencePhotoId, checklist: updated.checklist, active: updated.active } } : current); await load(); setNotice(active ? 'Стенд отключён.' : 'Стенд включён.') }
		catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Не удалось изменить статус стенда.'); await load() } finally { setSaving(false) }
	}
	async function review(decision: 'checked' | 'rejected') {
		if (!selected || saving) return
		if (decision === 'rejected' && !reviewComment.trim()) { setNotice('Для отклонения укажите причину.'); return }
		setSaving(true); setNotice(null)
		try { await operationsApi.merchandising.review(selected.id, { decision, comment: reviewComment.trim() }); setReviewComment(''); const refreshedRows = await load(); const refreshed = refreshedRows?.find((row) => row.id === selected.id); if (refreshed) { setSelected(refreshed); setHistory((await operationsApi.merchandising.history(refreshed.id)).data) } setNotice(decision === 'checked' ? 'Проверка принята.' : 'Проверка отклонена.') }
		catch (reason) { if (reason instanceof Error && 'status' in reason && reason.status === 409) { const refreshedRows = await load(); const refreshed = refreshedRows?.find((row) => row.id === selected.id); if (refreshed) { setSelected(refreshed); setHistory((await operationsApi.merchandising.history(refreshed.id)).data) } setNotice('Проверка уже изменилась. Список обновлён.') } else setNotice(reason instanceof Error ? reason.message : 'Не удалось сохранить проверку.') }
		finally { setSaving(false) }
	}

	return <div className="management-page">
		<PageHeader title="Выкладка" description="Стенды, эталонные материалы и фото-проверки магазинов." action={<Button onClick={openCreate}><Plus size={15} />Новый стенд</Button>} />
		{catalog.error && <ErrorNotice message={catalog.error} />}{notice && <div className="operation-notice" role="status">{notice}<button type="button" aria-label="Скрыть сообщение" onClick={() => setNotice(null)}>×</button></div>}
		<div className="management-filters operation-filters"><Select aria-label="Магазин" value={storeId} onChange={(event) => { setStoreId(event.target.value); setPage(1) }}><option value="">Все магазины</option>{catalog.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select><Select aria-label="Статус проверки" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">Все проверки</option><option value="submitted">На проверке</option><option value="checked">Проверено</option><option value="rejected">Нужна доработка</option></Select><Select aria-label="Состояние стенда" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}><option value="active">Активные стенды</option><option value="inactive">Неактивные стенды</option><option value="all">Все стенды</option></Select></div>
		{error && <ErrorNotice message={error} onRetry={() => void load()} />}
		<div className="management-grid operation-layout"><section className="management-surface"><div className="panel-header"><div><h2>Стенды и проверки</h2><p>Фото и история загружаются через закрытые BFF-маршруты.</p></div></div>
			{loading ? <LoadingState /> : items.length === 0 ? <EmptyState title="Записей нет" text="Измените фильтры или создайте стенд." /> : <div className="table-scroll"><table className="data-table management-table"><thead><tr><th>Стенд</th><th>Магазин</th><th>Бренд</th><th>Отправлено</th><th>Статус проверки</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.id}-${item.displayId}`} tabIndex={0} aria-selected={selected?.id === item.id} onClick={() => void refreshDetails(item)} onKeyDown={(event) => activateTableRow(event, () => void refreshDetails(item))}><td><strong>{item.currentDisplay?.name ?? item.displayName}</strong></td><td>{catalog.storeNames.get(item.storeId) ?? '—'}</td><td>{(item.currentDisplay?.brand ?? item.brand) || '—'}</td><td>{dateLabel(item.submittedAt ?? item.createdAt)}</td><td><StatusBadge status={item.status} /></td></tr>)}</tbody></table></div>}
			{!loading && <Pagination page={page} totalPages={pagination.totalPages} total={pagination.total} onPage={setPage} />}
		</section>
		<section className="panel management-inspector operation-inspector">{selected ? <>
			<div className="panel-header"><div><h2>{selected.currentDisplay?.name ?? selected.displayName}</h2><p>{catalog.storeNames.get(selected.storeId) ?? 'Магазин'} · {(selected.currentDisplay?.brand ?? selected.brand) || 'Без бренда'}</p></div><StatusBadge status={selected.status} /></div>
			<div className="panel-content"><dl className="management-meta"><div><dt>Версия проверки</dt><dd>{selected.version ?? '—'}</dd></div><div><dt>Отправил</dt><dd>{selected.submittedBy ? catalog.userNames.get(selected.submittedBy) ?? 'Сотрудник' : '—'}</dd></div><div><dt>Отправлено</dt><dd>{dateLabel(selected.submittedAt)}</dd></div><div><dt>Проверил</dt><dd>{selected.reviewerId ? catalog.userNames.get(selected.reviewerId) ?? 'Менеджер' : '—'}</dd></div><div><dt>Проверено</dt><dd>{dateLabel(selected.reviewedAt)}</dd></div><div><dt>Стенд</dt><dd>{(selected.currentDisplay?.active ?? selected.active) ? 'Активен' : 'Отключён'}</dd></div></dl>
				{selected.status !== 'draft' && <div className="operation-compare"><figure><figcaption>Эталон</figcaption><img src={`/api/admin/photos/${selected.referencePhotoId}/image`} alt={`Эталонная выкладка: ${selected.displayName}`} loading="lazy" /></figure><figure><figcaption>Фото магазина</figcaption>{selected.actualPhotoId ? <img src={operationEvidenceUrl('merchandising_inspection', selected.id, selected.actualPhotoId)} alt={`Фото проверки: ${selected.displayName}`} loading="lazy" /> : <div className="operation-image-empty">Фото не приложено</div>}</figure></div>}
				{selected.checklist.length > 0 && <div className="operation-section"><strong>Чеклист</strong>{selected.checklist.map((check, index) => <p className="operation-history-row" key={`${index}-${check}`}><span aria-label={selected.checklistResults[index] ? 'Выполнено' : 'Не выполнено'}>{selected.checklistResults[index] ? '✓' : '○'}</span> {check}</p>)}</div>}
				{selected.comment && <p className="operation-rejection">Комментарий: {selected.comment}</p>}
				<div className="management-actions"><Button size="sm" variant="outline" onClick={() => openEdit(selected)}><Pencil size={14} />Изменить стенд</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => void toggleActive(selected)}><Power size={14} />{(selected.currentDisplay?.active ?? selected.active) ? 'Отключить' : 'Включить'}</Button></div>
				{canReview && selected.status === 'submitted' && <div className="operation-section"><strong>Решение по проверке</strong><div className="form-field"><label htmlFor="inspection-comment">Комментарий (при отклонении обязателен)</label><Textarea id="inspection-comment" maxLength={2000} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} /></div><div className="management-actions"><Button size="sm" disabled={saving} onClick={() => void review('checked')}><Check size={14} />Принять</Button><Button size="sm" variant="destructive" disabled={saving || !reviewComment.trim()} onClick={() => void review('rejected')}><X size={14} />Отклонить</Button></div></div>}
				<div className="operation-section"><strong>История проверки</strong>{history.length === 0 ? <p className="role-note">История пока пуста.</p> : history.map((entry) => <p className="operation-history-row" key={entry.id}>{dateLabel(entry.createdAt)} · {catalog.userNames.get(entry.actorId) ?? 'Пользователь'} · {historyText(entry)}</p>)}</div>
			</div>
		</> : <EmptyState title="Выберите стенд или проверку" text="Здесь появятся фотографии, чеклист и история." />}</section></div>
		<Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} title={editingId ? 'Изменить стенд' : 'Новый стенд'} className="operation-dialog"><form className="dialog-form" onSubmit={(event) => void saveDisplay(event)}><div className="form-grid">
			{!editingId && <div className="form-field form-field-full"><label htmlFor="display-store">Магазин</label><Select id="display-store" required value={form.storeId} onChange={(event) => setForm({ ...form, storeId: event.target.value, referencePhotoId: '' })}><option value="">Выберите магазин</option>{catalog.stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}</Select></div>}
			<div className="form-field"><label htmlFor="display-name">Название</label><Input id="display-name" required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="form-field"><label htmlFor="display-brand">Бренд</label><Input id="display-brand" maxLength={120} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></div>
			<div className="form-field form-field-full"><label htmlFor="display-reference">Эталонное фото</label><Select id="display-reference" required value={form.referencePhotoId} onChange={(event) => setForm({ ...form, referencePhotoId: event.target.value })}><option value="">{photoLoading ? 'Загрузка фото…' : 'Выберите фото из этого магазина'}</option>{photos.map((photo) => <option key={photo.id} value={photo.id}>{photo.originalFilename}</option>)}</Select></div>
			<div className="form-field form-field-full"><label htmlFor="display-checklist">Чеклист (по одному пункту на строку)</label><Textarea id="display-checklist" rows={4} value={form.checklist} onChange={(event) => setForm({ ...form, checklist: event.target.value })} /></div>
			{!editingId && <div className="form-field form-field-full"><label htmlFor="display-campaign">Связанная кампания (необязательно)</label><Select id="display-campaign" value={form.campaignId} onChange={(event) => setForm({ ...form, campaignId: event.target.value })}><option value="">Без кампании</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}</Select></div>}
			{editingId && <label className="checkbox-row form-field-full"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Активный стенд</label>}
			</div><div className="form-actions"><Button type="button" variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>Отмена</Button><Button type="submit" disabled={saving || (!editingId && !form.storeId) || !form.referencePhotoId}>{saving && <LoaderCircle size={14} className="animate-spin" />}Сохранить</Button></div></form></Dialog>
	</div>
}

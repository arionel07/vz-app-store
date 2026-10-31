'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, LoaderCircle, Pencil, Plus, Send, X } from 'lucide-react'
import { campaignStatusSchema, photoListResponseSchema, type CampaignCreate, type CampaignResponse, type CampaignUpdate, type PhotoResponse } from '@vizaje/contracts'
import { useSessionUser } from '@/components/session-provider'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ManagementError, managementFetch } from '@/lib/management-client'
import { operationEvidenceUrl, operationsApi } from '@/lib/operations-client'
import { activateTableRow, dateLabel, EmptyState, ErrorNotice, historyText, LoadingState, localDateTime, PAGE_SIZE, PageHeader, Pagination, StatusBadge, useOperationCatalog } from '@/components/operations-common'

type CampaignForm = { title: string; description: string; startsAt: string; endsAt: string; timezone: string; storeIds: string[]; requiredActions: string; requiresPhoto: boolean; referencePhotoIds: string[] }
const emptyForm: CampaignForm = { title: '', description: '', startsAt: '', endsAt: '', timezone: 'Europe/Chisinau', storeIds: [], requiredActions: '', requiresPhoto: false, referencePhotoIds: [] }

function formFromCampaign(value: CampaignResponse): CampaignForm {
	return { title: value.title, description: value.description, startsAt: localDateTime(value.startsAt), endsAt: localDateTime(value.endsAt), timezone: value.timezone, storeIds: value.storeIds, requiredActions: value.requiredActions.join('\n'), requiresPhoto: value.requiresPhoto, referencePhotoIds: value.referencePhotoIds }
}

export function CampaignsOperationsPage() {
	const user = useSessionUser()
	const isAdmin = user.role === 'admin'
	const canReview = user.role === 'admin' || user.role === 'manager'
	const catalog = useOperationCatalog()
	const [items, setItems] = useState<CampaignResponse[]>([])
	const [selected, setSelected] = useState<CampaignResponse | null>(null)
	const [history, setHistory] = useState<Array<{ id: string; executionId: string; actorId: string; action: string; comment: string | null; version?: number; createdAt: string }>>([])
	const [photos, setPhotos] = useState<PhotoResponse[]>([])
	const [form, setForm] = useState<CampaignForm>(emptyForm)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [reviewComment, setReviewComment] = useState('')
	const [reviewExecutionId, setReviewExecutionId] = useState<string | null>(null)
	const [status, setStatus] = useState('')
	const [storeId, setStoreId] = useState('')
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [photoLoading, setPhotoLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [photoError, setPhotoError] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true); setError(null)
		try {
			const response = await operationsApi.campaigns.list({ page, pageSize: PAGE_SIZE, status: status || undefined, storeId: storeId || undefined })
			setItems(response.data); setPagination(response.pagination)
			if (selected && !response.data.some((item) => item.id === selected.id)) setSelected(null)
		} catch (reason) { setError(reason instanceof ManagementError && reason.status === 403 ? 'Недостаточно прав для просмотра кампаний.' : 'Не удалось загрузить кампании. Проверьте соединение с API.') } finally { setLoading(false) }
	}, [page, selected, status, storeId])
	useEffect(() => { void load() }, [load])

	const loadSelected = useCallback(async (id: string) => {
		try {
			const [campaign, timeline] = await Promise.all([operationsApi.campaigns.get(id), operationsApi.campaigns.history(id)])
			setSelected(campaign); setHistory(timeline.data)
		} catch (reason) { setNotice(reason instanceof ManagementError && reason.status === 409 ? 'Запись обновлена другим пользователем. Список перезагружен.' : 'Не удалось загрузить подробности кампании.'); await load() }
	}, [load])

	useEffect(() => {
		if (!dialogOpen || form.storeIds.length === 0) { setPhotos([]); return }
		let cancelled = false
		setPhotoLoading(true); setPhotoError(null)
		Promise.all(form.storeIds.map((targetStoreId) => managementFetch(`/api/admin/photos?page=1&pageSize=100&storeId=${targetStoreId}`, photoListResponseSchema)))
			.then((responses) => { if (!cancelled) setPhotos([...new Map(responses.flatMap((response) => response.data).map((photo) => [photo.id, photo])).values()]) })
			.catch(() => { if (!cancelled) { setPhotos([]); setPhotoError('Не удалось загрузить фото выбранных магазинов.') } })
			.finally(() => { if (!cancelled) setPhotoLoading(false) })
		return () => { cancelled = true }
	}, [dialogOpen, form.storeIds])

	const storeNames = catalog.storeNames
	const selectedStoreCount = selected?.storeIds.length ?? 0
	const checkedCount = selected?.executions?.filter((execution) => execution.status === 'checked').length ?? 0
	const storeOptions = useMemo(() => catalog.stores.filter((store) => store.isActive), [catalog.stores])

	function openCreate() { setEditingId(null); setForm(emptyForm); setDialogOpen(true); setNotice(null) }
	function openEdit(campaign: CampaignResponse) { setEditingId(campaign.id); setForm(formFromCampaign(campaign)); setDialogOpen(true); setNotice(null) }
	function toggleStore(id: string) { setForm((value) => ({ ...value, storeIds: value.storeIds.includes(id) ? value.storeIds.filter((store) => store !== id) : [...value.storeIds, id], referencePhotoIds: [] })) }
	function togglePhoto(id: string) { setForm((value) => ({ ...value, referencePhotoIds: value.referencePhotoIds.includes(id) ? value.referencePhotoIds.filter((photoId) => photoId !== id) : [...value.referencePhotoIds, id] })) }

	async function saveCampaign(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); if (saving) return
		setSaving(true); setNotice(null)
		try {
			const payload: CampaignCreate = {
				title: form.title.trim(), description: form.description.trim(), startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), timezone: form.timezone.trim(),
				storeIds: form.storeIds, requiredActions: form.requiredActions.split('\n').map((action) => action.trim()).filter(Boolean), requiresPhoto: form.requiresPhoto, referencePhotoIds: form.referencePhotoIds,
			}
			if (editingId) {
				const patch: CampaignUpdate = payload
				await operationsApi.campaigns.update(editingId, patch)
				await loadSelected(editingId)
				setNotice('Черновик кампании сохранён.')
			} else {
				const created = await operationsApi.campaigns.create(payload)
				setSelected(created); setNotice('Черновик кампании создан.')
			}
			setDialogOpen(false); await load()
		} catch (reason) { setNotice(reason instanceof ManagementError && reason.status === 409 ? 'Черновик изменён параллельно. Данные обновлены.' : reason instanceof Error ? reason.message : 'Не удалось сохранить кампанию.') ; if (editingId) await loadSelected(editingId) } finally { setSaving(false) }
	}

	async function runAction(action: 'publish' | 'complete' | 'archive' | 'cancel') {
		if (!selected || saving) return
		const prompts = { publish: 'Опубликовать кампанию? Её параметры и целевые магазины станут неизменяемыми.', complete: 'Завершить кампанию? Все отчёты магазинов должны быть проверены.', archive: 'Переместить кампанию в архив?', cancel: 'Отменить кампанию?' }
		if (!window.confirm(prompts[action])) return
		setSaving(true); setNotice(null)
		try {
			if (action === 'publish') await operationsApi.campaigns.publish(selected.id)
			else await operationsApi.campaigns.transition(selected.id, { action })
			await load(); await loadSelected(selected.id); setNotice('Статус кампании обновлён.')
		} catch (reason) {
			if (reason instanceof ManagementError && reason.status === 409) { await load(); await loadSelected(selected.id); setNotice('Конфликт изменения: данные обновлены. Проверьте текущий статус кампании.') }
			else setNotice(reason instanceof Error ? reason.message : 'Не удалось изменить статус кампании.')
		} finally { setSaving(false) }
	}

	async function reviewExecution(executionId: string, decision: 'checked' | 'rejected') {
		if (!selected || saving) return
		if (decision === 'rejected' && !reviewComment.trim()) { setNotice('Для отклонения отчёта укажите причину.'); return }
		setSaving(true); setNotice(null)
		try {
			await operationsApi.campaigns.review(executionId, { decision, comment: reviewComment.trim() })
			setReviewExecutionId(null); setReviewComment(''); await load(); await loadSelected(selected.id); setNotice(decision === 'checked' ? 'Отчёт проверен.' : 'Отчёт отклонён.')
		} catch (reason) {
			if (reason instanceof ManagementError && reason.status === 409) { await load(); await loadSelected(selected.id); setNotice('Отчёт уже изменён. Данные обновлены; проверьте его статус.') }
			else setNotice(reason instanceof Error ? reason.message : 'Не удалось сохранить результат проверки.')
		} finally { setSaving(false) }
	}

	return <div className="management-page">
		<PageHeader title="Кампании" description="Планирование кампаний и проверка исполнения магазинами." action={isAdmin ? <Button onClick={openCreate}><Plus size={15} />Новая кампания</Button> : undefined} />
		{catalog.error && <ErrorNotice message={catalog.error} />}
		<div className="management-filters operation-filters"><Select aria-label="Статус кампании" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">Все статусы</option>{campaignStatusSchema.options.map((value) => <option key={value} value={value}>{({ draft: 'Черновик', scheduled: 'Запланирована', active: 'Активна', completed: 'Завершена', archived: 'В архиве', cancelled: 'Отменена' } as Record<string, string>)[value]}</option>)}</Select><Select aria-label="Магазин" value={storeId} onChange={(event) => { setStoreId(event.target.value); setPage(1) }}><option value="">Все магазины</option>{storeOptions.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select><Button variant="outline" onClick={() => void load()}>Обновить</Button></div>
		{error && <ErrorNotice message={error} onRetry={() => void load()} />}{notice && <div className="operation-notice" role="status">{notice}<button type="button" aria-label="Скрыть сообщение" onClick={() => setNotice(null)}>×</button></div>}
		<div className="management-grid operation-layout"><section className="management-surface"><div className="panel-header"><div><h2>Список кампаний</h2><p>Прогресс рассчитан по проверенным отчётам магазинов.</p></div></div>
			{loading ? <LoadingState /> : items.length === 0 ? <EmptyState title="Кампаний нет" text="Создайте черновик или измените фильтры." /> : <div className="table-scroll"><table className="data-table management-table"><thead><tr><th>Кампания</th><th>Период</th><th>Магазины</th><th>Прогресс</th><th>Статус</th></tr></thead><tbody>{items.map((campaign) => { const checked = campaign.executions?.filter((execution) => execution.status === 'checked').length ?? 0; const count = campaign.storeIds.length; return <tr key={campaign.id} tabIndex={0} aria-selected={selected?.id === campaign.id} onClick={() => void loadSelected(campaign.id)} onKeyDown={(event) => activateTableRow(event, () => void loadSelected(campaign.id))}><td><strong>{campaign.title}</strong></td><td>{dateLabel(campaign.startsAt)}<small className="block text-muted-foreground">до {dateLabel(campaign.endsAt)}</small></td><td>{count}</td><td>{checked}/{count}</td><td><StatusBadge status={campaign.status} /></td></tr> })}</tbody></table></div>}
			{!loading && <Pagination page={page} totalPages={pagination.totalPages} total={pagination.total} onPage={setPage} />}
		</section>
		<section className="panel management-inspector operation-inspector">{selected ? <>
			<div className="panel-header"><div><h2>{selected.title}</h2><p>{dateLabel(selected.startsAt)} — {dateLabel(selected.endsAt)} · {selected.timezone}</p></div><StatusBadge status={selected.status} /></div>
			<div className="panel-content">
				{selected.description && <p className="operation-description">{selected.description}</p>}
				<dl className="management-meta"><div><dt>Целевые магазины</dt><dd>{selectedStoreCount}</dd></div><div><dt>Проверено</dt><dd>{checkedCount}/{selectedStoreCount}</dd></div><div><dt>Фото обязательно</dt><dd>{selected.requiresPhoto ? 'Да' : 'Нет'}</dd></div></dl>
				{selected.requiredActions.length > 0 && <div className="operation-section"><strong>Действия</strong><ol>{selected.requiredActions.map((action, index) => <li key={`${index}-${action}`}>{action}</li>)}</ol></div>}
				{selected.referencePhotoIds.length > 0 && <div className="operation-section"><strong>Материалы</strong><div className="task-evidence-grid">{selected.referencePhotoIds.map((photoId) => <img key={photoId} src={operationEvidenceUrl('campaign_reference', selected.id, photoId)} alt="Материал кампании" loading="lazy" className="task-evidence-image" />)}</div></div>}
				{isAdmin && selected.status === 'draft' && <div className="management-actions"><Button size="sm" variant="outline" onClick={() => openEdit(selected)}><Pencil size={14} />Изменить</Button><Button size="sm" onClick={() => void runAction('publish')} disabled={saving}><Send size={14} />Опубликовать</Button><Button size="sm" variant="destructive" onClick={() => void runAction('cancel')} disabled={saving}><X size={14} />Отменить</Button></div>}
				{isAdmin && ['scheduled', 'active'].includes(selected.status) && <div className="management-actions"><Button size="sm" variant="outline" onClick={() => void runAction('complete')} disabled={saving}>Завершить</Button><Button size="sm" variant="destructive" onClick={() => void runAction('cancel')} disabled={saving}>Отменить</Button></div>}
				{isAdmin && ['completed', 'cancelled'].includes(selected.status) && <Button size="sm" variant="outline" onClick={() => void runAction('archive')} disabled={saving}>В архив</Button>}
				<div className="operation-section"><strong>Исполнение по магазинам</strong>{(selected.executions ?? []).length === 0 ? <p className="role-note">Список магазинов исполнения не получен.</p> : <div className="operation-list">{selected.executions?.map((execution) => <article className="operation-list-card" key={execution.id}><header><strong>{storeNames.get(execution.storeId) ?? 'Магазин'}</strong><StatusBadge status={execution.status} /></header><p>Отправка {execution.version ?? '—'} · {dateLabel(execution.submittedAt)}</p>{execution.submittedBy && <p>Отправил: {catalog.userNames.get(execution.submittedBy) ?? 'Сотрудник'}</p>}{execution.reviewerId && <p>Проверил: {catalog.userNames.get(execution.reviewerId) ?? 'Менеджер'}</p>}{execution.reviewComment && <p className="operation-rejection">Причина: {execution.reviewComment}</p>}{(execution.evidencePhotoIds ?? []).length > 0 && <div className="task-evidence-grid">{execution.evidencePhotoIds?.map((photoId) => <img key={photoId} src={operationEvidenceUrl('campaign_execution', execution.id, photoId)} alt="Фото исполнения кампании" loading="lazy" className="task-evidence-image" />)}</div>}{canReview && execution.status === 'submitted' && <div className="management-actions"><Button size="sm" disabled={saving} onClick={() => { if (window.confirm('Принять отчёт магазина?')) { setReviewExecutionId(null); setReviewComment(''); void reviewExecution(execution.id, 'checked') } }}><Check size={14} />Проверить</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => { setReviewExecutionId(execution.id); setReviewComment('') }}><X size={14} />Отклонить</Button></div>}{reviewExecutionId === execution.id && <div className="form-field"><label htmlFor={`campaign-review-${execution.id}`}>Причина отклонения</label><Textarea id={`campaign-review-${execution.id}`} value={reviewComment} maxLength={2000} onChange={(event) => setReviewComment(event.target.value)} /><div className="management-actions"><Button size="sm" variant="destructive" disabled={saving || !reviewComment.trim()} onClick={() => void reviewExecution(execution.id, 'rejected')}>Подтвердить отказ</Button><Button size="sm" variant="ghost" disabled={saving} onClick={() => setReviewExecutionId(null)}>Отмена</Button></div></div>}</article>)}</div>}</div>
				<div className="operation-section"><strong>История</strong>{history.length === 0 ? <p className="role-note">История пока пуста.</p> : history.map((entry) => <p className="operation-history-row" key={entry.id}>{dateLabel(entry.createdAt)} · {catalog.userNames.get(entry.actorId) ?? 'Пользователь'} · {historyText(entry)}</p>)}</div>
			</div>
		</> : <EmptyState title="Выберите кампанию" text="Здесь отображаются целевые магазины, выполнение и история проверок." />}</section></div>
		<Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} title={editingId ? 'Редактировать черновик' : 'Новая кампания'} className="operation-dialog"><form className="dialog-form" onSubmit={(event) => void saveCampaign(event)}><div className="form-grid">
			<div className="form-field form-field-full"><label htmlFor="campaign-title">Название</label><Input id="campaign-title" required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></div>
			<div className="form-field form-field-full"><label htmlFor="campaign-description">Описание и инструкции</label><Textarea id="campaign-description" maxLength={10000} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
			<div className="form-field"><label htmlFor="campaign-start">Начало</label><Input id="campaign-start" type="datetime-local" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></div>
			<div className="form-field"><label htmlFor="campaign-end">Окончание</label><Input id="campaign-end" type="datetime-local" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></div>
			<div className="form-field"><label htmlFor="campaign-timezone">Часовой пояс</label><Input id="campaign-timezone" required maxLength={100} value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></div>
			<div className="form-field form-field-full"><fieldset><legend>Целевые магазины</legend><div className="store-checklist">{catalog.loading ? <p>Загрузка магазинов…</p> : storeOptions.map((store) => <label className="store-check" key={store.id}><input type="checkbox" checked={form.storeIds.includes(store.id)} onChange={() => toggleStore(store.id)} />{store.name}</label>)}</div></fieldset></div>
			<div className="form-field form-field-full"><label htmlFor="campaign-actions">Обязательные действия (по одному на строку)</label><Textarea id="campaign-actions" rows={3} value={form.requiredActions} onChange={(event) => setForm({ ...form, requiredActions: event.target.value })} /></div>
			<label className="checkbox-row form-field-full"><input type="checkbox" checked={form.requiresPhoto} onChange={(event) => setForm({ ...form, requiresPhoto: event.target.checked })} /> Требуется фотоотчёт</label>
			<div className="form-field form-field-full"><fieldset><legend>Разрешённые фото-материалы</legend>{photoLoading ? <p className="role-note">Загрузка фото…</p> : photoError ? <p className="field-error">{photoError}</p> : form.storeIds.length === 0 ? <p className="role-note">Сначала выберите магазины.</p> : photos.length === 0 ? <p className="role-note">В выбранных магазинах нет доступных фото.</p> : <div className="operation-photo-picker">{photos.map((photo) => <label className="operation-photo-option" key={photo.id}><input type="checkbox" checked={form.referencePhotoIds.includes(photo.id)} onChange={() => togglePhoto(photo.id)} /><img src={`/api/admin/photos/${photo.id}/image`} alt={photo.originalFilename} /><span>{photo.originalFilename}</span></label>)}</div>}</fieldset></div>
			</div><div className="form-actions"><Button type="button" variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>Отмена</Button><Button type="submit" disabled={saving || form.storeIds.length === 0}>{saving && <LoaderCircle size={14} className="animate-spin" />}{editingId ? 'Сохранить черновик' : 'Создать черновик'}</Button></div></form></Dialog>
	</div>
}

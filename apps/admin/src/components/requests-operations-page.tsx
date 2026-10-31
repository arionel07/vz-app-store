'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, PackageCheck, Play, X } from 'lucide-react'
import type { RequestResponse } from '@vizaje/contracts'
import { useSessionUser } from '@/components/session-provider'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ManagementError } from '@/lib/management-client'
import { operationEvidenceUrl, operationsApi } from '@/lib/operations-client'
import { activateTableRow, categoryLabels, dateLabel, EmptyState, ErrorNotice, historyText, LoadingState, PAGE_SIZE, PageHeader, Pagination, StatusBadge, useOperationCatalog } from '@/components/operations-common'

type RequestHistory = { id: string; requestId: string; actorId: string; fromStatus: string | null; toStatus: string; comment: string | null; createdAt: string }

export function RequestsOperationsPage() {
	const user = useSessionUser()
	const canManage = user.role === 'admin' || user.role === 'manager'
	const catalog = useOperationCatalog()
	const [items, setItems] = useState<RequestResponse[]>([])
	const [selected, setSelected] = useState<RequestResponse | null>(null)
	const [history, setHistory] = useState<RequestHistory[]>([])
	const [storeId, setStoreId] = useState('')
	const [status, setStatus] = useState('')
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [decisionComment, setDecisionComment] = useState('')
	const [assignedTo, setAssignedTo] = useState('')
	const [operationComment, setOperationComment] = useState('')
	const [saving, setSaving] = useState(false)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true); setError(null)
		try { const result = await operationsApi.requests.list({ page, pageSize: PAGE_SIZE, storeId: storeId || undefined, status: status || undefined }); setItems(result.data); setPagination(result.pagination); if (selected && !result.data.some((request) => request.id === selected.id)) setSelected(null) }
		catch (reason) { setError(reason instanceof ManagementError && reason.status === 403 ? 'Нет доступа к выбранному магазину.' : 'Не удалось загрузить заявки.') }
		finally { setLoading(false) }
	}, [page, selected, status, storeId])
	useEffect(() => { void load() }, [load])
	const eligibleAssignees = useMemo(() => catalog.users.filter((employee) => ['staff', 'manager'].includes(employee.role) && selected?.storeId && employee.storeIds.includes(selected.storeId)), [catalog.users, selected?.storeId])

	const selectRequest = useCallback(async (request: RequestResponse) => {
		setSelected(request); setAssignedTo(request.assignedTo ?? ''); setDecisionComment(''); setOperationComment(''); setNotice(null)
		try { const [detail, timeline] = await Promise.all([operationsApi.requests.get(request.id), operationsApi.requests.history(request.id)]); setSelected(detail); setAssignedTo(detail.assignedTo ?? ''); setHistory(timeline.data) }
		catch (reason) { setNotice(reason instanceof ManagementError && reason.status === 404 ? 'Заявка не найдена или доступ к магазину отозван.' : 'Не удалось загрузить детали заявки.') }
	}, [])
	async function refresh() { await load(); if (selected) await selectRequest(selected) }

	async function decide(decision: 'approved' | 'rejected') {
		if (!selected || saving) return
		if (decision === 'rejected' && !decisionComment.trim()) { setNotice('Для отказа укажите комментарий.'); return }
		if (!window.confirm(decision === 'approved' ? 'Одобрить заявку?' : 'Отклонить заявку?')) return
		setSaving(true); setNotice(null)
		try { await operationsApi.requests.decide(selected.id, { decision, comment: decisionComment.trim() }); await load(); await selectRequest(selected); setNotice(decision === 'approved' ? 'Заявка одобрена.' : 'В заявке отказано.') }
		catch (reason) { if (reason instanceof ManagementError && reason.status === 409) { await refresh(); setNotice('Заявка уже рассмотрена. Состояние обновлено.') } else setNotice(reason instanceof Error ? reason.message : 'Не удалось принять решение.') }
		finally { setSaving(false) }
	}
	async function updateRequest(values: { status?: 'in_progress' | 'completed'; assignedTo?: string | null; comment?: string }) {
		if (!selected || saving) return
		const nextStatus = values.status
		if (nextStatus === 'completed' && !window.confirm('Отметить заявку как выполненную?')) return
		if (nextStatus === 'in_progress' && !window.confirm('Начать выполнение заявки?')) return
		setSaving(true); setNotice(null)
		try { const updated = await operationsApi.requests.update(selected.id, values); setSelected(updated); await load(); setHistory((await operationsApi.requests.history(updated.id)).data); setNotice(nextStatus === 'completed' ? 'Заявка выполнена.' : nextStatus === 'in_progress' ? 'Выполнение начато.' : 'Ответственный назначен.') }
		catch (reason) { if (reason instanceof ManagementError && reason.status === 409) { await refresh(); setNotice('Заявка изменилась параллельно. Данные обновлены.') } else setNotice(reason instanceof Error ? reason.message : 'Не удалось обновить заявку.') }
		finally { setSaving(false) }
	}

	return <div className="management-page">
		<PageHeader title="Заявки" description="Запросы магазинов, решения, ответственные и выполнение." />
		{catalog.error && <ErrorNotice message={catalog.error} />}{notice && <div className="operation-notice" role="status">{notice}<button type="button" aria-label="Скрыть сообщение" onClick={() => setNotice(null)}>×</button></div>}
		<div className="management-filters operation-filters"><Select aria-label="Магазин" value={storeId} onChange={(event) => { setStoreId(event.target.value); setPage(1) }}><option value="">Все магазины</option>{catalog.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select><Select aria-label="Статус заявки" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">Все статусы</option><option value="submitted">Новая</option><option value="approved">Одобрена</option><option value="rejected">Отклонена</option><option value="in_progress">В работе</option><option value="completed">Выполнена</option></Select><Button variant="outline" onClick={() => void load()}>Обновить</Button></div>
		{error && <ErrorNotice message={error} onRetry={() => void load()} />}
		<div className="management-grid operation-layout"><section className="management-surface"><div className="panel-header"><div><h2>Входящие заявки</h2><p>Данные и доступ ограничены назначенными магазинами.</p></div></div>
			{loading ? <LoadingState /> : items.length === 0 ? <EmptyState title="Заявок нет" text="По выбранным фильтрам записи не найдены." /> : <div className="table-scroll"><table className="data-table management-table"><thead><tr><th>Запрос</th><th>Магазин</th><th>Инициатор</th><th>Создана</th><th>Статус</th></tr></thead><tbody>{items.map((request) => <tr key={request.id} tabIndex={0} aria-selected={selected?.id === request.id} onClick={() => void selectRequest(request)} onKeyDown={(event) => activateTableRow(event, () => void selectRequest(request))}><td><strong>{categoryLabels[request.category] ?? request.category}</strong><small className="block text-muted-foreground">{request.quantity || request.description.slice(0, 70)}</small></td><td>{catalog.storeNames.get(request.storeId) ?? '—'}</td><td>{catalog.userNames.get(request.requesterId) ?? 'Сотрудник'}</td><td>{dateLabel(request.createdAt)}</td><td><StatusBadge status={request.status} /></td></tr>)}</tbody></table></div>}
			{!loading && <Pagination page={page} totalPages={pagination.totalPages} total={pagination.total} onPage={setPage} />}
		</section>
		<section className="panel management-inspector operation-inspector">{selected ? <>
			<div className="panel-header"><div><h2>{categoryLabels[selected.category] ?? selected.category}</h2><p>{catalog.storeNames.get(selected.storeId) ?? 'Магазин'} · {dateLabel(selected.createdAt)}</p></div><StatusBadge status={selected.status} /></div>
			<div className="panel-content"><p className="operation-description">{selected.description}</p><dl className="management-meta"><div><dt>Количество</dt><dd>{selected.quantity || '—'}</dd></div><div><dt>Запросил</dt><dd>{catalog.userNames.get(selected.requesterId) ?? 'Сотрудник'}</dd></div><div><dt>Ответственный</dt><dd>{selected.assignedTo ? catalog.userNames.get(selected.assignedTo) ?? 'Сотрудник' : 'Не назначен'}</dd></div><div><dt>Решение</dt><dd>{selected.decisionComment || '—'}</dd></div></dl>
				{selected.attachmentPhotoIds.length > 0 && <div className="operation-section"><strong>Вложения</strong><div className="task-evidence-grid">{selected.attachmentPhotoIds.map((photoId) => <img key={photoId} className="task-evidence-image" loading="lazy" src={operationEvidenceUrl('operational_request', selected.id, photoId)} alt="Вложение к заявке" />)}</div></div>}
				{canManage && selected.status === 'submitted' && <div className="operation-section"><strong>Рассмотрение</strong><div className="form-field"><label htmlFor="request-decision-comment">Комментарий к решению (при отказе обязателен)</label><Textarea id="request-decision-comment" maxLength={2000} value={decisionComment} onChange={(event) => setDecisionComment(event.target.value)} /></div><div className="management-actions"><Button size="sm" disabled={saving} onClick={() => void decide('approved')}><Check size={14} />Одобрить</Button><Button size="sm" variant="destructive" disabled={saving || !decisionComment.trim()} onClick={() => void decide('rejected')}><X size={14} />Отклонить</Button></div></div>}
				{canManage && ['approved', 'in_progress'].includes(selected.status) && <div className="operation-section"><strong>Выполнение</strong><div className="form-field"><label htmlFor="request-assignee">Ответственный (необязательно)</label><Select id="request-assignee" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">Не назначен</option>{eligibleAssignees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.role === 'manager' ? 'менеджер' : 'сотрудник'}</option>)}</Select></div><div className="form-field"><label htmlFor="request-operation-comment">Комментарий</label><Textarea id="request-operation-comment" maxLength={2000} value={operationComment} onChange={(event) => setOperationComment(event.target.value)} /></div><div className="management-actions">{selected.status === 'approved' && <Button size="sm" disabled={saving} onClick={() => void updateRequest({ status: 'in_progress', ...(assignedTo !== (selected.assignedTo ?? '') ? { assignedTo: assignedTo || null } : {}), comment: operationComment.trim() || undefined })}><Play size={14} />Начать выполнение</Button>}{selected.status === 'in_progress' && <Button size="sm" disabled={saving} onClick={() => void updateRequest({ status: 'completed', ...(assignedTo !== (selected.assignedTo ?? '') ? { assignedTo: assignedTo || null } : {}), comment: operationComment.trim() || undefined })}><PackageCheck size={14} />Отметить выполненной</Button>}{assignedTo !== (selected.assignedTo ?? '') && <Button size="sm" variant="outline" disabled={saving} onClick={() => void updateRequest({ assignedTo: assignedTo || null, comment: operationComment.trim() || undefined })}>Сохранить ответственного</Button>}</div></div>}
				<div className="operation-section"><strong>История</strong>{history.length === 0 ? <p className="role-note">История пока пуста.</p> : history.map((entry) => <p className="operation-history-row" key={entry.id}>{dateLabel(entry.createdAt)} · {catalog.userNames.get(entry.actorId) ?? 'Пользователь'} · {historyText(entry)}</p>)}</div>
			</div>
		</> : <EmptyState title="Выберите заявку" text="Здесь появятся детали запроса, решение и история выполнения." />}</section></div>
	</div>
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import type { IssueResponse } from '@vizaje/contracts'
import { useSessionUser } from '@/components/session-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ManagementError } from '@/lib/management-client'
import { operationEvidenceUrl, operationsApi } from '@/lib/operations-client'
import { activateTableRow, categoryLabels, dateLabel, EmptyState, ErrorNotice, historyText, LoadingState, PAGE_SIZE, PageHeader, Pagination, priorityLabels, StatusBadge, useOperationCatalog } from '@/components/operations-common'

type IssueHistory = { id: string; issueId: string; actorId: string; action: string; fromStatus: string | null; toStatus: string | null; reason: string | null; previousPriority: string | null; newPriority: string | null; createdAt: string }

export function IssuesOperationsPage() {
	const user = useSessionUser()
	const canManage = user.role === 'admin' || user.role === 'manager'
	const catalog = useOperationCatalog()
	const [items, setItems] = useState<IssueResponse[]>([])
	const [selected, setSelected] = useState<IssueResponse | null>(null)
	const [history, setHistory] = useState<IssueHistory[]>([])
	const [storeId, setStoreId] = useState('')
	const [status, setStatus] = useState('')
	const [priority, setPriority] = useState('')
	const [page, setPage] = useState(1)
	const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 })
	const [assignedTo, setAssignedTo] = useState('')
	const [nextPriority, setNextPriority] = useState('')
	const [resolutionNotes, setResolutionNotes] = useState('')
	const [reopenReason, setReopenReason] = useState('')
	const [saving, setSaving] = useState(false)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true); setError(null)
		try { const result = await operationsApi.issues.list({ page, pageSize: PAGE_SIZE, storeId: storeId || undefined, status: status || undefined, priority: priority || undefined }); setItems(result.data); setPagination(result.pagination); if (selected && !result.data.some((issue) => issue.id === selected.id)) setSelected(null) }
		catch (reason) { setError(reason instanceof ManagementError && reason.status === 403 ? 'Нет доступа к выбранному магазину.' : 'Не удалось загрузить проблемы.') }
		finally { setLoading(false) }
	}, [page, priority, selected, status, storeId])
	useEffect(() => { void load() }, [load])

	const eligibleAssignees = useMemo(() => catalog.users.filter((employee) => ['staff', 'manager'].includes(employee.role) && selected?.storeId && employee.storeIds.includes(selected.storeId)), [catalog.users, selected?.storeId])

	const selectIssue = useCallback(async (issue: IssueResponse) => {
		setSelected(issue); setAssignedTo(issue.assignedTo ?? ''); setNextPriority(issue.priority); setResolutionNotes(''); setReopenReason(''); setNotice(null)
		try { const [detail, timeline] = await Promise.all([operationsApi.issues.get(issue.id), operationsApi.issues.history(issue.id)]); setSelected(detail); setAssignedTo(detail.assignedTo ?? ''); setNextPriority(detail.priority); setHistory(timeline.data) }
		catch (reason) { setNotice(reason instanceof ManagementError && reason.status === 404 ? 'Проблема не найдена или доступ к магазину отозван.' : 'Не удалось загрузить детали проблемы.') }
	}, [])

	async function refresh() {
		await load()
		if (selected) await selectIssue(selected)
	}
	async function saveAssignment() {
		if (!selected || saving) return
		setSaving(true); setNotice(null)
		try { const updated = await operationsApi.issues.update(selected.id, { assignedTo: assignedTo || null }); setSelected(updated); await load(); const timeline = await operationsApi.issues.history(updated.id); setHistory(timeline.data); setNotice('Ответственный обновлён.') }
		catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Не удалось назначить ответственного.'); if (reason instanceof ManagementError && reason.status === 409) await refresh() }
		finally { setSaving(false) }
	}
	async function savePriority() {
		if (!selected || saving || nextPriority === selected.priority) return
		setSaving(true); setNotice(null)
		try { const updated = await operationsApi.issues.priority(selected.id, { priority: nextPriority as IssueResponse['priority'], expectedPriority: selected.priority }); setSelected(updated); await load(); setHistory((await operationsApi.issues.history(updated.id)).data); setNotice('Приоритет обновлён.') }
		catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Не удалось изменить приоритет.'); if (reason instanceof ManagementError && reason.status === 409) await refresh() }
		finally { setSaving(false) }
	}
	async function transition(statusNext: IssueResponse['status']) {
		if (!selected || saving) return
		if (statusNext === 'resolved' && !resolutionNotes.trim()) { setNotice('Добавьте заметку о решении проблемы.'); return }
		if (statusNext === 'open' && !reopenReason.trim()) { setNotice('Укажите причину повторного открытия.'); return }
		const confirmation = statusNext === 'closed' ? 'Закрыть решённую проблему?' : statusNext === 'resolved' ? 'Отметить проблему как решённую?' : statusNext === 'open' ? 'Повторно открыть проблему?' : null
		if (confirmation && !window.confirm(confirmation)) return
		setSaving(true); setNotice(null)
		try { const updated = await operationsApi.issues.update(selected.id, { status: statusNext, ...(statusNext === 'resolved' ? { resolutionNotes } : {}), ...(statusNext === 'open' ? { reopenReason } : {}) }); setSelected(updated); await load(); setHistory((await operationsApi.issues.history(updated.id)).data); setNotice(`Статус обновлён: ${statusLabels[updated.status] ?? updated.status}.`) }
		catch (reason) { if (reason instanceof ManagementError && reason.status === 409) { await refresh(); setNotice('Проблема изменилась параллельно. Данные обновлены.') } else setNotice(reason instanceof Error ? reason.message : 'Переход статуса не выполнен.') }
		finally { setSaving(false) }
	}
	const statusLabels: Record<string, string> = { open: 'Открыта', in_progress: 'В работе', resolved: 'Решена', closed: 'Закрыта' }

	return <div className="management-page">
		<PageHeader title="Проблемы" description="Обслуживание магазинов, приоритеты, ответственные и история." />
		{catalog.error && <ErrorNotice message={catalog.error} />}{notice && <div className="operation-notice" role="status">{notice}<button type="button" aria-label="Скрыть сообщение" onClick={() => setNotice(null)}>×</button></div>}
		<div className="management-filters operation-filters"><Select aria-label="Магазин" value={storeId} onChange={(event) => { setStoreId(event.target.value); setPage(1) }}><option value="">Все магазины</option>{catalog.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select><Select aria-label="Статус проблемы" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">Все статусы</option>{Object.entries(statusLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</Select><Select aria-label="Приоритет" value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1) }}><option value="">Все приоритеты</option>{Object.entries(priorityLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</Select></div>
		{error && <ErrorNotice message={error} onRetry={() => void load()} />}
		<div className="management-grid operation-layout"><section className="management-surface"><div className="panel-header"><div><h2>Список проблем</h2><p>Список ограничен доступными магазинам текущего пользователя.</p></div></div>
			{loading ? <LoadingState /> : items.length === 0 ? <EmptyState title="Проблем нет" text="По выбранным фильтрам записи не найдены." /> : <div className="table-scroll"><table className="data-table management-table"><thead><tr><th>Проблема</th><th>Магазин</th><th>Ответственный</th><th>Приоритет</th><th>Статус</th></tr></thead><tbody>{items.map((issue) => <tr key={issue.id} tabIndex={0} aria-selected={selected?.id === issue.id} onClick={() => void selectIssue(issue)} onKeyDown={(event) => activateTableRow(event, () => void selectIssue(issue))}><td><strong>{issue.title}</strong><small className="block text-muted-foreground">{categoryLabels[issue.category] ?? issue.category} · {dateLabel(issue.createdAt)}</small></td><td>{catalog.storeNames.get(issue.storeId) ?? '—'}</td><td>{issue.assignedTo ? catalog.userNames.get(issue.assignedTo) ?? 'Сотрудник' : 'Не назначен'}</td><td>{priorityLabels[issue.priority]}</td><td><StatusBadge status={issue.status} /></td></tr>)}</tbody></table></div>}
			{!loading && <Pagination page={page} totalPages={pagination.totalPages} total={pagination.total} onPage={setPage} />}
		</section>
		<section className="panel management-inspector operation-inspector">{selected ? <>
			<div className="panel-header"><div><h2>{selected.title}</h2><p>{catalog.storeNames.get(selected.storeId) ?? 'Магазин'} · {categoryLabels[selected.category] ?? selected.category}</p></div><StatusBadge status={selected.status} /></div>
			<div className="panel-content"><p className="operation-description">{selected.description}</p><dl className="management-meta"><div><dt>Создана</dt><dd>{dateLabel(selected.createdAt)}</dd></div><div><dt>Сообщил</dt><dd>{catalog.userNames.get(selected.reporterId) ?? 'Сотрудник'}</dd></div><div><dt>Решена</dt><dd>{dateLabel(selected.resolvedAt)}</dd></div></dl>
				{selected.photoIds.length > 0 && <div className="operation-section"><strong>Фото доказательства</strong><div className="task-evidence-grid">{selected.photoIds.map((photoId) => <img key={photoId} className="task-evidence-image" loading="lazy" src={operationEvidenceUrl('store_issue', selected.id, photoId)} alt="Фото проблемы магазина" />)}</div></div>}
				{canManage && <>
					<div className="operation-section"><strong>Ответственный</strong><div className="operation-inline-form"><Select aria-label="Ответственный сотрудник" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">Не назначен</option>{eligibleAssignees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.role === 'manager' ? 'менеджер' : 'сотрудник'}</option>)}</Select><Button size="sm" variant="outline" disabled={saving || assignedTo === (selected.assignedTo ?? '')} onClick={() => void saveAssignment()}>Назначить</Button></div></div>
					<div className="operation-section"><strong>Приоритет</strong><div className="operation-inline-form"><Select aria-label="Новый приоритет" value={nextPriority} onChange={(event) => setNextPriority(event.target.value)}>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select><Button size="sm" variant="outline" disabled={saving || nextPriority === selected.priority} onClick={() => void savePriority()}>Изменить</Button></div></div>
					<div className="operation-section"><strong>Действия</strong><div className="management-actions">{selected.status === 'open' && <Button size="sm" disabled={saving} onClick={() => void transition('in_progress')}><Play size={14} />Начать работу</Button>}{selected.status === 'in_progress' && <><Button size="sm" disabled={saving || !resolutionNotes.trim()} onClick={() => void transition('resolved')}><Check size={14} />Решена</Button><Textarea aria-label="Заметка о решении" placeholder="Опишите выполненное исправление" value={resolutionNotes} onChange={(event) => setResolutionNotes(event.target.value)} /></>}{selected.status === 'resolved' && <Button size="sm" variant="outline" disabled={saving} onClick={() => void transition('closed')}><ShieldCheck size={14} />Закрыть</Button>}{['resolved', 'closed'].includes(selected.status) && <><Textarea aria-label="Причина повторного открытия" placeholder="Причина повторного открытия" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} /><Button size="sm" variant="outline" disabled={saving || !reopenReason.trim()} onClick={() => void transition('open')}><RotateCcw size={14} />Открыть снова</Button></>}</div></div>
				</>}
				<div className="operation-section"><strong>История</strong>{history.length === 0 ? <p className="role-note">История пока пуста.</p> : history.map((entry) => <p className="operation-history-row" key={entry.id}>{dateLabel(entry.createdAt)} · {catalog.userNames.get(entry.actorId) ?? 'Пользователь'} · {historyText(entry)}{entry.previousPriority && entry.newPriority ? ` · ${priorityLabels[entry.previousPriority] ?? entry.previousPriority} → ${priorityLabels[entry.newPriority] ?? entry.newPriority}` : ''}</p>)}</div>
			</div>
		</> : <EmptyState title="Выберите проблему" text="Здесь появятся описание, фото, ответственный и история." />}</section></div>
	</div>
}

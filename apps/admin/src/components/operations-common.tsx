'use client'

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { StoreResponse, UserResponse } from '@vizaje/contracts'
import { storeListResponseSchema, userListResponseSchema } from '@vizaje/contracts'
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { managementFetch, ManagementError, formatDate } from '@/lib/management-client'

export const PAGE_SIZE = 15
export const statusLabels: Record<string, string> = {
	draft: 'Черновик', scheduled: 'Запланирована', active: 'Активна', completed: 'Завершена', archived: 'В архиве', cancelled: 'Отменена',
	not_started: 'Не начато', in_progress: 'В работе', submitted: 'На проверке', checked: 'Проверено', rejected: 'Нужна доработка',
	open: 'Открыта', resolved: 'Решена', closed: 'Закрыта', approved: 'Одобрена',
}
export const categoryLabels: Record<string, string> = {
	lighting: 'Освещение', shelving: 'Стеллажи', payment_terminal: 'Платёжный терминал', tester: 'Тестер', climate: 'Климат', display: 'Выкладка', equipment: 'Оборудование', other: 'Другое',
	testers: 'Тестеры', promotional_materials: 'Промоматериалы', supplies: 'Расходные материалы', assistance: 'Помощь',
}
export const priorityLabels: Record<string, string> = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', urgent: 'Срочный' }
const historyActionLabels: Record<string, string> = { created: 'Создана', submitted: 'Отправлен отчёт', assigned: 'Назначен ответственный', updated: 'Обновлена', reopened: 'Повторно открыта', priority_changed: 'Изменён приоритет' }

export function errorText(error: unknown, fallback = 'Не удалось выполнить операцию'): string {
	if (!(error instanceof ManagementError)) return fallback
	if (error.status === 401) return 'Сеанс завершён. Войдите снова.'
	if (error.status === 403) return 'Недостаточно прав или магазин вне вашей зоны доступа.'
	if (error.status === 404) return 'Запись или файл не найден. Обновите данные.'
	if (error.status === 409) return 'Запись изменилась или действие уже выполнено. Данные обновлены.'
	if (error.status === 400) return error.message || 'Проверьте введённые данные.'
	if (error.status >= 500) return 'Сервис временно недоступен. Попробуйте позже.'
	return error.message || fallback
}

export function StatusBadge({ status }: { status: string }) {
	const tone = status === 'checked' || status === 'completed' || status === 'approved' || status === 'resolved' ? 'green' : status === 'rejected' || status === 'cancelled' ? 'danger' : status === 'submitted' || status === 'in_progress' || status === 'active' ? 'orange' : 'neutral'
	return <Badge tone={tone}>{statusLabels[status] ?? status}</Badge>
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
	return <div className="management-toolbar"><div><h1 className="page-title">{title}</h1><p className="role-note">{description}</p></div>{action && <div className="management-toolbar-actions">{action}</div>}</div>
}

export function activateTableRow(event: ReactKeyboardEvent<HTMLTableRowElement>, activate: () => void) {
	if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() }
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return <div className="management-error" role="alert"><AlertTriangle size={15} className="mr-2 inline" />{message}{onRetry && <button type="button" onClick={onRetry}>Повторить</button>}</div>
}

export function LoadingState({ label = 'Загрузка данных' }: { label?: string }) {
	return <div className="operation-loading" role="status" aria-label={label}><Skeleton className="operation-skeleton-title" /><Skeleton /><Skeleton /><Skeleton className="operation-skeleton-short" /></div>
}

export function EmptyState({ title, text }: { title: string; text: string }) {
	return <div className="management-state"><div><strong>{title}</strong><p>{text}</p></div></div>
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (page: number) => void }) {
	return <div className="management-pagination"><span>Всего: {total}</span><div className="management-pagination-actions"><Button size="icon-xs" variant="ghost" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /></Button><span>{page} / {Math.max(totalPages, 1)}</span><Button size="icon-xs" variant="ghost" aria-label="Следующая страница" disabled={page >= totalPages} onClick={() => onPage(page + 1)}><ChevronRight /></Button></div></div>
}

export function useOperationCatalog() {
	const [stores, setStores] = useState<StoreResponse[]>([])
	const [users, setUsers] = useState<UserResponse[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	useEffect(() => {
		let cancelled = false
		Promise.all([
			managementFetch('/api/admin/stores?page=1&pageSize=100&isActive=true&sortBy=name&sortDirection=asc', storeListResponseSchema),
			managementFetch('/api/admin/employees?page=1&pageSize=100&sortBy=lastName&sortDirection=asc', userListResponseSchema),
		]).then(([storeResult, userResult]) => {
			if (cancelled) return
			setStores(storeResult.data.filter((store) => store.isActive))
			setUsers(userResult.data.filter((user) => user.isActive))
		}).catch((reason) => { if (!cancelled) setError(errorText(reason, 'Не удалось загрузить справочники')) }).finally(() => { if (!cancelled) setLoading(false) })
		return () => { cancelled = true }
	}, [])
	const storeNames = new Map(stores.map((store) => [store.id, store.name]))
	const userNames = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`]))
	return { stores, users, storeNames, userNames, loading, error }
}

export function localDateTime(value?: string | null): string {
	if (!value) return ''
	const date = new Date(value)
	const offset = date.getTimezoneOffset() * 60_000
	return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function dateLabel(value?: string | null): string {
	return value ? formatDate(value) : '—'
}

export function historyText(row: { action?: string; fromStatus?: string | null; toStatus?: string | null; comment?: string | null; reason?: string | null; version?: number }) {
	const action = row.action ? statusLabels[row.action] ?? historyActionLabels[row.action] ?? row.action : `${row.fromStatus ? statusLabels[row.fromStatus] ?? row.fromStatus : 'Создано'} → ${row.toStatus ? statusLabels[row.toStatus] ?? row.toStatus : ''}`
	const transition = row.action && row.fromStatus !== row.toStatus && row.toStatus ? ` · ${row.fromStatus ? statusLabels[row.fromStatus] ?? row.fromStatus : 'Создано'} → ${statusLabels[row.toStatus] ?? row.toStatus}` : ''
	return `${action}${transition}${row.version ? ` · версия ${row.version}` : ''}${row.comment || row.reason ? ` · ${row.comment ?? row.reason}` : ''}`
}

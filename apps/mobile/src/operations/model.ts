import type { StoreResponse } from '@vizaje/contracts'

export const operationStatuses: Record<string, string> = {
	not_started: 'Не начато', in_progress: 'В работе', submitted: 'На проверке', checked: 'Проверено', rejected: 'Нужно исправить',
	draft: 'Черновик', scheduled: 'Запланировано', active: 'Активна', completed: 'Завершена', archived: 'В архиве', cancelled: 'Отменена',
	open: 'Открыта', resolved: 'Решена', closed: 'Закрыта', approved: 'Одобрена', in_review: 'На рассмотрении',
}

export const issueCategories = [
	['lighting', 'Освещение'], ['shelving', 'Стеллажи'], ['payment_terminal', 'Терминал оплаты'], ['tester', 'Тестер'],
	['climate', 'Климат'], ['display', 'Выкладка'], ['equipment', 'Оборудование'], ['other', 'Другое'],
] as const

export const requestCategories = [
	['testers', 'Тестеры'], ['promotional_materials', 'Промоматериалы'], ['supplies', 'Расходные материалы'],
	['assistance', 'Помощь'], ['equipment', 'Оборудование'], ['other', 'Другое'],
] as const

export function authorizedOperationStore(stores: StoreResponse[], requestedId: string | null): StoreResponse | null {
	const active = stores.filter((store) => store.isActive)
	if (requestedId) return active.find((store) => store.id === requestedId) ?? null
	return active.length === 1 ? active[0] ?? null : null
}

export function canResubmitOperation(status: string): boolean {
	return status === 'rejected'
}

export function operationProgress(status: string): number {
	if (status === 'checked' || status === 'completed' || status === 'resolved') return 100
	if (status === 'submitted' || status === 'approved' || status === 'in_progress') return 65
	if (status === 'rejected') return 35
	return 0
}

export function operationErrorMessage(error: unknown): string {
	const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : -1
	if (status === 0) return 'Нет соединения. Проверьте интернет и повторите попытку.'
	if (status === 401) return 'Сессия закончилась. Войдите снова.'
	if (status === 403) return 'У вас больше нет доступа к этому магазину или материалу.'
	if (status === 404) return 'Запись недоступна или была удалена.'
	if (status === 409) return 'Данные уже изменились. Обновите экран и проверьте статус.'
	if (status === 429) return 'Слишком много запросов. Немного подождите и попробуйте снова.'
	if (status === 400) return 'Проверьте заполнение формы и приложенные фотографии.'
	return 'Не удалось выполнить действие. Попробуйте ещё раз.'
}

export function dateRangeLabel(startsAt: string, endsAt: string): string {
	const date = (value: string) => new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
	return `${date(startsAt)} — ${date(endsAt)}`
}

import { reportFiltersSchema, type ReportFilters, type ReportPeriodPreset } from '@vizaje/contracts'

export const REPORT_TIMEZONE = 'Europe/Chisinau'
export const REPORT_PAGE_SIZE = 20
export const REPORT_OPERATION_LINKS = [
	{ href: '/operations/campaigns', label: 'Кампании' },
	{ href: '/operations/merchandising', label: 'Выкладка' },
	{ href: '/operations/issues', label: 'Проблемы' },
	{ href: '/operations/requests', label: 'Заявки' },
] as const

export const REPORT_PERIODS: Array<{ value: ReportPeriodPreset; label: string }> = [
	{ value: 'today', label: 'Сегодня' },
	{ value: 'last_7_days', label: 'Последние 7 дней' },
	{ value: 'last_30_days', label: 'Последние 30 дней' },
	{ value: 'current_month', label: 'Текущий месяц' },
	{ value: 'previous_month', label: 'Прошлый месяц' },
	{ value: 'custom', label: 'Свой период' },
]

const filterKeys = new Set(['period', 'startDate', 'endDate', 'timezone', 'storeId'])

function localToday(now: Date): string {
	const parts = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
	const date = Object.fromEntries(parts.map((part) => [part.type, part.value]))
	return `${date.year}-${date.month}-${date.day}`
}

export function defaultCustomPeriod(now = new Date()): { startDate: string; endDate: string } {
	const endDate = localToday(now)
	const start = new Date(`${endDate}T00:00:00.000Z`)
	start.setUTCDate(start.getUTCDate() - 29)
	return { startDate: start.toISOString().slice(0, 10), endDate }
}

export function validateReportFilters(raw: Record<string, string>): { filters: ReportFilters | null; error: string | null } {
	const parsed = reportFiltersSchema.safeParse(raw)
	if (!parsed.success) {
		if (raw.period === 'custom') {
			if (!raw.startDate || !raw.endDate) return { filters: null, error: 'Для своего периода укажите обе даты.' }
			if (raw.startDate > raw.endDate) return { filters: null, error: 'Дата начала не может быть позже даты окончания.' }
			return { filters: null, error: 'Укажите корректные календарные даты.' }
		}
		return { filters: null, error: 'Проверьте параметры периода и магазина.' }
	}
	if (parsed.data.period === 'custom') {
		const start = Date.parse(`${parsed.data.startDate}T00:00:00.000Z`)
		const end = Date.parse(`${parsed.data.endDate}T00:00:00.000Z`)
		if ((end - start) / 86_400_000 + 1 > 366) return { filters: null, error: 'Период не может превышать 366 календарных дней.' }
	}
	return { filters: parsed.data, error: null }
}

export function reportQuery(filters: ReportFilters, additions: Record<string, string | number | undefined> = {}): string {
	const query = new URLSearchParams()
	for (const [key, value] of Object.entries({ ...filters, ...additions })) {
		if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
	}
	return query.toString()
}

export function mergeReportingSearch(search: string, patch: Record<string, string | null>): string {
	const params = new URLSearchParams(search)
	for (const [key, value] of Object.entries(patch)) {
		if (value === null || value === '') params.delete(key)
		else params.set(key, value)
	}
	if (Object.keys(patch).some((key) => filterKeys.has(key)) && !('page' in patch)) params.set('page', '1')
	return params.toString()
}

export function reportingRequestKey(view: string, filters: ReportFilters, page: number, employeeId?: string): string {
	return JSON.stringify({ view, filters, page, employeeId: employeeId ?? null })
}

export function isCurrentReportingResult(resultKey: string | undefined, activeKey: string): boolean {
	return resultKey === activeKey
}

export function formatReportDate(value: string): string {
	return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`))
}

export function formatReportNumber(value: number): string {
	return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

export function formatReportPercent(value: number | null): string {
	return value === null ? '—' : `${formatReportNumber(value)}%`
}

export function reportErrorMessage(error: unknown): string {
	if (!(error instanceof Error) || !('status' in error)) return 'Не удалось загрузить отчёт. Проверьте подключение и повторите попытку.'
	const status = Number(error.status)
	if (status === 401) return 'Сеанс завершён. Войдите в систему снова.'
	if (status === 403) return 'У вашей роли нет доступа к этой отчётности.'
	if (status === 404) return 'Выбранный магазин или сотрудник больше недоступен. Сбросьте фильтр и повторите запрос.'
	if (status === 409) return 'Данные изменились. Обновите отчёт и повторите попытку.'
	if (status >= 500) return 'Сервис отчётности временно недоступен. Попробуйте ещё раз.'
	return error.message || 'Не удалось загрузить отчёт.'
}

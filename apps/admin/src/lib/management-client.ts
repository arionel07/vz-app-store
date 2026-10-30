import { getBrowserCsrfToken } from '@/lib/auth-client'

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } }

export class ManagementError extends Error {
	constructor(public readonly status: number, public readonly code: string, message: string) {
		super(message)
		this.name = 'ManagementError'
	}
}

async function parsePayload(response: Response): Promise<unknown> {
	const text = await response.text()
	if (!text) return null
	try {
		return JSON.parse(text)
	} catch {
		return null
	}
}

export async function managementFetch<T>(
	path: string,
	schema: Schema<T>,
	options: RequestInit = {},
): Promise<T> {
	const headers = new Headers(options.headers)
	headers.set('Accept', 'application/json')
	if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
	if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
		const csrfToken = getBrowserCsrfToken()
		if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
	}

	const response = await fetch(path, {
		...options,
		headers,
		credentials: 'same-origin',
		cache: 'no-store',
	})
	const payload = await parsePayload(response)
	if (!response.ok) {
		const error = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
		const details = error && typeof error === 'object' ? error : null
		const code = details && 'code' in details && typeof details.code === 'string' ? details.code : 'REQUEST_FAILED'
		const message = details && 'message' in details && typeof details.message === 'string' ? details.message : 'Операция не выполнена'
		throw new ManagementError(response.status, code, message)
	}

	const parsed = schema.safeParse(payload)
	if (!parsed.success) throw new ManagementError(502, 'INVALID_RESPONSE', 'Сервис вернул некорректные данные')
	return parsed.data
}

export async function managementFetchNoContent(path: string, options: RequestInit = {}): Promise<void> {
	const headers = new Headers(options.headers)
	headers.set('Accept', 'application/json')
	if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
		const csrfToken = getBrowserCsrfToken()
		if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
	}
	const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' })
	if (response.ok) return
	const payload = await parsePayload(response)
	const error = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
	const details = error && typeof error === 'object' ? error : null
	const code = details && 'code' in details && typeof details.code === 'string' ? details.code : 'REQUEST_FAILED'
	const message = details && 'message' in details && typeof details.message === 'string' ? details.message : 'Операция не выполнена'
	throw new ManagementError(response.status, code, message)
}

export function isUnauthorized(error: unknown): boolean {
	return error instanceof ManagementError && (error.status === 401 || error.status === 403)
}

export function formatDate(value: string): string {
	return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function formatDateOnly(value: string): string {
	return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(value))
}

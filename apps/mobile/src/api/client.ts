import {
	activationRedeemRequestSchema,
	errorResponseSchema,
	logoutResponseSchema,
	mobileSessionResponseSchema,
	storeListResponseSchema,
	userResponseSchema,
	type MobileSessionResponse,
	type StoreListQuery,
	type StoreListResponse,
	type UserResponse,
} from '@vizaje/contracts'

const REQUEST_TIMEOUT_MS = 10_000

export class ApiError extends Error {
	readonly name = 'ApiError'

	constructor(readonly status: number, readonly code: string, message: string) {
		super(message)
	}
}

export function isNetworkError(error: unknown): error is ApiError {
	return error instanceof ApiError && error.status === 0
}

function apiOrigin(): string {
	const configured = process.env.EXPO_PUBLIC_API_URL?.trim() || 'http://127.0.0.1:3000'
	try {
		const url = new URL(configured)
		const localDevelopment = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
		if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localDevelopment)) throw new Error('API must use HTTPS outside local development')
		return url.toString().replace(/\/$/, '')
	} catch {
		throw new ApiError(0, 'INVALID_API_URL', 'Адрес API настроен неверно')
	}
}

type ResponseSchema<T> = {
	safeParse: (value: unknown) => { success: true; data: T } | { success: false }
}

type RequestOptions = {
	method?: 'GET' | 'POST'
	token?: string
	body?: unknown
	allowRetry?: boolean
}

function requestError(status: number, body: unknown): ApiError {
	const parsed = errorResponseSchema.safeParse(body)
	if (parsed.success) return new ApiError(status, parsed.data.error.code, parsed.data.error.message)
	return new ApiError(status, status >= 500 ? 'SERVER_UNAVAILABLE' : 'REQUEST_FAILED', 'Не удалось выполнить запрос')
}

async function requestJson<T>(path: string, schema: ResponseSchema<T>, options: RequestOptions = {}): Promise<T> {
	const method = options.method ?? 'GET'
	const headers: Record<string, string> = { Accept: 'application/json' }
	if (options.body !== undefined) headers['Content-Type'] = 'application/json'
	if (options.token) headers.Authorization = `Bearer ${options.token}`

	let attempt = 0
	while (true) {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
		try {
			const response = await fetch(`${apiOrigin()}${path}`, {
				method,
				headers,
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				credentials: 'omit',
				signal: controller.signal,
			})
			let body: unknown = null
			try {
				body = await response.json()
			} catch {
				body = null
			}
			if (!response.ok) throw requestError(response.status, body)
			const parsed = schema.safeParse(body)
			if (!parsed.success) throw new ApiError(502, 'INVALID_API_RESPONSE', 'Сервер вернул некорректный ответ')
			return parsed.data
		} catch (error) {
			if (error instanceof ApiError) throw error
			const networkError = new ApiError(0, 'NETWORK_UNAVAILABLE', 'Сервис временно недоступен')
			if (options.allowRetry && method === 'GET' && attempt === 0) {
				attempt += 1
				continue
			}
			throw networkError
		} finally {
			clearTimeout(timeout)
		}
	}
}

export function redeemActivation(secret: string, deviceId: string): Promise<MobileSessionResponse> {
	const body = activationRedeemRequestSchema.parse({ secret, deviceId })
	return requestJson('/api/v1/auth/activation/redeem', mobileSessionResponseSchema, { method: 'POST', body })
}

export function getCurrentUser(token: string): Promise<UserResponse> {
	return requestJson('/api/v1/auth/me', userResponseSchema, { token, allowRetry: true })
}

export function listStores(token: string, query: StoreListQuery = { page: 1, pageSize: 100, sortBy: 'name', sortDirection: 'asc' }): Promise<StoreListResponse> {
	const params = new URLSearchParams({
		page: String(query.page),
		pageSize: String(query.pageSize),
		sortBy: query.sortBy,
		sortDirection: query.sortDirection,
		...(query.isActive === undefined ? {} : { isActive: String(query.isActive) }),
		...(query.search ? { search: query.search } : {}),
	})
	return requestJson(`/api/v1/stores?${params.toString()}`, storeListResponseSchema, { token, allowRetry: true })
}

export function renewMobileSession(token: string): Promise<MobileSessionResponse> {
	return requestJson('/api/v1/auth/mobile/renew', mobileSessionResponseSchema, { method: 'POST', token })
}

export function logoutMobileSession(token: string): Promise<{ success: true }> {
	return requestJson('/api/v1/auth/logout', logoutResponseSchema, { method: 'POST', token })
}

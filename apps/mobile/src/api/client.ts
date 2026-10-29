import {
	activationRedeemRequestSchema,
	errorResponseSchema,
	logoutResponseSchema,
	mobileLoginRequestSchema,
	mobileSessionResponseSchema,
	staffQuizListResponseSchema,
	quizStaffResponseSchema,
	attemptResponseSchema,
	attemptListResponseSchema,
	submitAttemptInputSchema,
	storeListResponseSchema,
	photoListResponseSchema,
	photoResponseSchema,
	employeeProfileSafeResponseSchema,
	userResponseSchema,
	type AttemptListQuery,
	type AttemptListResponse,
	type AttemptResponse,
	type MobileSessionResponse,
	type QuizListQuery,
	type QuizStaffResponse,
	type StaffQuizListResponse,
	type StoreListQuery,
	type StoreListResponse,
	type PhotoListResponse,
	type PhotoResponse,
	type SubmitAttemptInput,
	type UserResponse,
	type EmployeeProfileSafeResponse,
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

function isDevelopmentRuntime(): boolean {
	if (typeof __DEV__ === 'boolean') return __DEV__
	return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
}

function isPrivateIpv4(hostname: string): boolean {
	const octets = hostname.split('.').map(Number)
	if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
	return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 169 && octets[1] === 254)
}

function isLocalDevelopmentHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
	return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized.endsWith('.local') || isPrivateIpv4(normalized)
}

export type ApiOriginOptions = { development?: boolean; allowInsecureHttp?: boolean }

export function resolveApiOrigin(configured: string | undefined, options: ApiOriginOptions = {}): string {
	if (!configured?.trim()) throw new ApiError(0, 'API_URL_REQUIRED', 'Адрес API не настроен')
	let url: URL
	try {
		url = new URL(configured.trim())
	} catch {
		throw new ApiError(0, 'INVALID_API_URL', 'Адрес API настроен неверно')
	}
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new ApiError(0, 'INVALID_API_URL', 'Адрес API должен быть origin без учетных данных и пути')
	if (url.protocol === 'https:') return url.toString().replace(/\/$/, '')
	const development = options.development ?? isDevelopmentRuntime()
	const allowInsecureHttp = options.allowInsecureHttp ?? process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP === 'true'
	if (url.protocol === 'http:' && development && allowInsecureHttp && isLocalDevelopmentHost(url.hostname)) return url.toString().replace(/\/$/, '')
	throw new ApiError(0, 'INSECURE_API_URL', 'Адрес API должен использовать HTTPS; HTTP разрешён только для локальной разработки')
}

function apiOrigin(): string {
	return resolveApiOrigin(process.env.EXPO_PUBLIC_API_URL)
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

export type PhotoUploadFile = {
	uri: string
	name: string
	type: 'image/jpeg' | 'image/png' | 'image/webp'
}

export type PhotoUploadOptions = { signal?: AbortSignal }

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

export function mobileLogin(email: string, password: string, deviceId: string): Promise<MobileSessionResponse> {
	const body = mobileLoginRequestSchema.parse({ email, password, deviceId })
	return requestJson('/api/v1/auth/mobile/login', mobileSessionResponseSchema, { method: 'POST', body })
}

export function getCurrentUser(token: string): Promise<UserResponse> {
	return requestJson('/api/v1/auth/me', userResponseSchema, { token, allowRetry: true })
}

export function getMyProfile(token: string): Promise<EmployeeProfileSafeResponse> {
	return requestJson('/api/v1/me/profile', employeeProfileSafeResponseSchema, { token, allowRetry: true })
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

export function listAvailableQuizzes(token: string, query: QuizListQuery = { page: 1, pageSize: 100 }): Promise<{ data: QuizStaffResponse[]; pagination: StaffQuizListResponse['pagination'] }> {
	const params = new URLSearchParams({
		page: String(query.page),
		pageSize: String(query.pageSize),
		...(query.search ? { search: query.search } : {}),
	})
	return requestJson(`/api/v1/quizzes?${params.toString()}`, staffQuizListResponseSchema, { token, allowRetry: true })
}

export function getAvailableQuiz(token: string, quizId: string): Promise<QuizStaffResponse> {
	return requestJson(`/api/v1/quizzes/${encodeURIComponent(quizId)}`, quizStaffResponseSchema, { token, allowRetry: true })
}

export function startQuizAttempt(token: string, quizId: string): Promise<AttemptResponse> {
	return requestJson(`/api/v1/quizzes/${encodeURIComponent(quizId)}/attempts`, attemptResponseSchema, { method: 'POST', token })
}

export function submitQuizAttempt(token: string, attemptId: string, input: SubmitAttemptInput): Promise<AttemptResponse> {
	const body = submitAttemptInputSchema.parse(input)
	return requestJson(`/api/v1/attempts/${encodeURIComponent(attemptId)}/submit`, attemptResponseSchema, { method: 'POST', token, body })
}

export function listMyAttempts(token: string, query: AttemptListQuery = { page: 1, pageSize: 100 }): Promise<AttemptListResponse> {
	const params = new URLSearchParams({
		page: String(query.page),
		pageSize: String(query.pageSize),
		...(query.quizId ? { quizId: query.quizId } : {}),
		...(query.status ? { status: query.status } : {}),
	})
	return requestJson(`/api/v1/attempts?${params.toString()}`, attemptListResponseSchema, { token, allowRetry: true })
}

export function getMyAttempt(token: string, attemptId: string): Promise<AttemptResponse> {
	return requestJson(`/api/v1/attempts/${encodeURIComponent(attemptId)}`, attemptResponseSchema, { token, allowRetry: true })
}

export function listPhotos(token: string, storeId: string, query: { page?: number; pageSize?: number } = {}): Promise<PhotoListResponse> {
	const params = new URLSearchParams({
		page: String(query.page ?? 1),
		pageSize: String(query.pageSize ?? 20),
	})
	return requestJson(`/api/v1/stores/${encodeURIComponent(storeId)}/photos?${params.toString()}`, photoListResponseSchema, { token, allowRetry: true })
}

export async function uploadPhoto(token: string, storeId: string, file: PhotoUploadFile, idempotencyKey: string, options: PhotoUploadOptions = {}): Promise<PhotoResponse> {
	const form = new FormData()
	// React Native fetch turns this descriptor into a multipart file part. Do not
	// set Content-Type manually: fetch must supply the boundary.
	form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob)
	const controller = new AbortController()
	const abortUpload = () => controller.abort()
	if (options.signal?.aborted) controller.abort()
	else options.signal?.addEventListener('abort', abortUpload)
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
	try {
		const response = await fetch(`${apiOrigin()}/api/v1/stores/${encodeURIComponent(storeId)}/photos`, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${token}`,
				'Idempotency-Key': idempotencyKey,
			},
			body: form,
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
		const parsed = photoResponseSchema.safeParse(body)
		if (!parsed.success) throw new ApiError(502, 'INVALID_API_RESPONSE', 'Сервер вернул некорректный ответ')
		return parsed.data
	} catch (error) {
		if (error instanceof ApiError) throw error
		if (options.signal?.aborted) throw new ApiError(0, 'UPLOAD_CANCELLED', 'Загрузка отменена')
		throw new ApiError(0, 'NETWORK_UNAVAILABLE', 'Сервис временно недоступен')
	} finally {
		clearTimeout(timeout)
		options.signal?.removeEventListener('abort', abortUpload)
	}
}

function photoExtension(mimeType: PhotoResponse['mimeType']): string {
	return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
}

export async function downloadPhotoImage(token: string, photo: Pick<PhotoResponse, 'id' | 'mimeType'>): Promise<string> {
	const FileSystem = await import('expo-file-system/legacy')
	if (!FileSystem.cacheDirectory) throw new ApiError(0, 'CACHE_UNAVAILABLE', 'Временное хранилище недоступно')
	const target = `${FileSystem.cacheDirectory}vizaje-photo-${encodeURIComponent(photo.id)}.${photoExtension(photo.mimeType)}`
	try {
		const result = await FileSystem.downloadAsync(`${apiOrigin()}/api/v1/photos/${encodeURIComponent(photo.id)}`, target, {
			headers: { Authorization: `Bearer ${token}`, Accept: photo.mimeType },
		})
		if (result.status < 200 || result.status >= 300) {
			await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined)
			throw new ApiError(result.status, result.status === 401 ? 'UNAUTHENTICATED' : result.status === 404 ? 'PHOTO_NOT_FOUND' : 'PHOTO_DOWNLOAD_FAILED', 'Не удалось загрузить фотографию')
		}
		return result.uri
	} catch (error) {
		if (error instanceof ApiError) throw error
		throw new ApiError(0, 'NETWORK_UNAVAILABLE', 'Сервис временно недоступен')
	}
}

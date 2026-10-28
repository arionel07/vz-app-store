import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import {
	adminLoginRequestSchema,
	browserLoginResponseSchema,
	errorResponseSchema,
	logoutResponseSchema,
	userResponseSchema,
	type UserResponse,
} from '@vizaje/contracts'
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from './auth-constants'

const AUTH_API_PREFIX = '/api/v1/auth/'
const MANAGEMENT_API_PREFIXES = [
	'/api/v1/users',
	'/api/v1/stores',
	'/api/v1/management/quizzes',
	'/api/v1/photos',
	'/api/v1/dashboard/overview',
	'/api/v1/dashboard/photos',
	'/api/v1/dashboard/quizzes',
]
const ACTIVATION_API_PREFIX = '/api/v1/auth/activation'
const NO_STORE_HEADERS = {
	'Cache-Control': 'private, no-store, max-age=0',
	Pragma: 'no-cache',
	Vary: 'Cookie',
}

type CookiePair = { name: string; value: string }
type SafeParseSchema<T> = {
	safeParse(value: unknown): { success: true; data: T } | { success: false }
}

export type AuthenticatedUser = UserResponse

function parseCookieHeader(header: string | null | undefined): CookiePair[] {
	if (!header) return []

	return header
		.split(';')
		.map((part) => {
			const separator = part.indexOf('=')
			if (separator <= 0) return null
			return {
				name: part.slice(0, separator).trim(),
				value: part.slice(separator + 1).trim(),
			}
		})
		.filter((cookie): cookie is CookiePair => Boolean(cookie?.name))
}

export function getCookieValue(header: string | null | undefined, name: string): string | null {
	return parseCookieHeader(header).find((cookie) => cookie.name === name)?.value ?? null
}

export function getSessionCookieHeader(header: string | null | undefined): string | null {
	const session = getCookieValue(header, SESSION_COOKIE_NAME)
	return session ? `${SESSION_COOKIE_NAME}=${session}` : null
}

function getApiBaseUrl(): string {
	const configuredUrl = process.env.VIZAJE_API_URL ?? (process.env.NODE_ENV === 'production' ? null : 'http://127.0.0.1:3000')
	if (!configuredUrl) throw new Error('VIZAJE_API_URL is required in production')

	const url = new URL(configuredUrl)
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('VIZAJE_API_URL must be an origin without credentials or a path')
	}

	return url.origin
}

function getApiUrl(path: string): string {
	const pathname = path.split('?', 1)[0]
	const allowed = pathname.startsWith(AUTH_API_PREFIX) || pathname === ACTIVATION_API_PREFIX || MANAGEMENT_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
	if (!allowed) throw new Error('This API path is not allowed through the BFF')
	return `${getApiBaseUrl()}${path}`
}

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface BffFetchOptions {
	method?: ApiMethod
	body?: string
	cookieHeader?: string | null
	csrfToken?: string | null
	userAgent?: string | null
}

export async function fetchBffApi(path: string, options: BffFetchOptions = {}): Promise<Response> {
	const method = options.method ?? 'GET'
	const headers = new Headers({ Accept: 'application/json' })
	if (options.body) headers.set('Content-Type', 'application/json')
	if (options.cookieHeader) headers.set('Cookie', options.cookieHeader)
	if (options.csrfToken) headers.set('X-CSRF-Token', options.csrfToken)
	if (options.userAgent) headers.set('User-Agent', options.userAgent)

	return fetch(getApiUrl(path), {
		method,
		headers,
		body: options.body,
		cache: 'no-store',
	})
}

export async function fetchAuthApi(path: string, options: BffFetchOptions = {}): Promise<Response> {
	if (!path.startsWith(AUTH_API_PREFIX)) throw new Error('Only authentication API paths may be fetched here')
	return fetchBffApi(path, options)
}

export async function fetchManagementApi(path: string, options: BffFetchOptions = {}): Promise<Response> {
	const pathname = path.split('?', 1)[0]
	const allowed = pathname === ACTIVATION_API_PREFIX || MANAGEMENT_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
	if (!allowed) throw new Error('Only management API paths may be fetched here')
	return fetchBffApi(path, options)
}

/*
	This helper is intentionally the only place where the browser's session
	cookie is copied to the upstream API. The BFF never forwards arbitrary
	cookies or exposes the session token to client JavaScript.
*/
export function getManagementRequestOptions(request: Request, options: { body?: string; method: ApiMethod }): BffFetchOptions {
	return {
		method: options.method,
		body: options.body,
		cookieHeader: getSessionCookieHeader(request.headers.get('cookie')),
		csrfToken: request.headers.get('x-csrf-token'),
		userAgent: request.headers.get('user-agent'),
	}
}

/*
	Keep this local request builder explicit for authentication routes too. It
	avoids accidental widening of cookie forwarding if a new browser cookie is
	added later.
*/
export function getAuthRequestOptions(request: Request, options: { body?: string; method: ApiMethod }): BffFetchOptions {
	return {
		method: options.method,
		body: options.body,
		cookieHeader: getSessionCookieHeader(request.headers.get('cookie')),
		csrfToken: request.headers.get('x-csrf-token'),
		userAgent: request.headers.get('user-agent'),
	}
}

async function readJson(response: Response): Promise<unknown> {
	const body = await response.text()
	if (!body) return null
	try {
		return JSON.parse(body)
	} catch {
		return null
	}
}

export function jsonError(status: number, code: string, message: string): NextResponse {
	return NextResponse.json(errorResponseSchema.parse({ error: { code, message } }), {
		status,
		headers: NO_STORE_HEADERS,
	})
}

function splitSetCookieHeader(header: string): string[] {
	return header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((value) => value.trim()).filter(Boolean)
}

function getSetCookieHeaders(headers: Headers): string[] {
	const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
	if (getSetCookie) return getSetCookie.call(headers)

	const combined = headers.get('set-cookie')
	return combined ? splitSetCookieHeader(combined) : []
}

function copyAuthSetCookies(response: NextResponse, upstream: Response): void {
	for (const cookie of getSetCookieHeaders(upstream.headers)) {
		const name = cookie.slice(0, cookie.indexOf('=')).trim()
		if (name === SESSION_COOKIE_NAME || name === CSRF_COOKIE_NAME) {
			response.headers.append('set-cookie', cookie)
		}
	}
}

export async function forwardBffResponse<T>(
	upstream: Response,
	schema: SafeParseSchema<T>,
	options: { forwardSetCookies?: boolean; invalidResponseMessage?: string; fallbackErrorCode?: string; fallbackErrorMessage?: string } = {},
): Promise<NextResponse> {
	const payload = await readJson(upstream)

	if (!upstream.ok) {
		const parsedError = errorResponseSchema.safeParse(payload)
		const response = NextResponse.json(
			parsedError.success
				? parsedError.data
				: errorResponseSchema.parse({
						error: {
							code: upstream.status === 401 ? 'UNAUTHENTICATED' : options.fallbackErrorCode ?? 'AUTH_REQUEST_FAILED',
							message: options.fallbackErrorMessage ?? 'Authentication request failed',
						},
				}),
			{ status: upstream.status, headers: NO_STORE_HEADERS },
		)
		if (options.forwardSetCookies) copyAuthSetCookies(response, upstream)
		return response
	}

	const parsed = schema.safeParse(payload)
	if (!parsed.success) return jsonError(502, 'AUTH_BACKEND_INVALID_RESPONSE', options.invalidResponseMessage ?? 'Сервис авторизации вернул некорректный ответ')

	const response = NextResponse.json(parsed.data, { status: upstream.status, headers: NO_STORE_HEADERS })
	if (options.forwardSetCookies) copyAuthSetCookies(response, upstream)
	return response
}

export async function forwardAuthResponse<T>(
	upstream: Response,
	schema: SafeParseSchema<T>,
	options: { forwardSetCookies?: boolean; invalidResponseMessage?: string; fallbackErrorCode?: string; fallbackErrorMessage?: string } = {},
): Promise<NextResponse> {
	return forwardBffResponse(upstream, schema, options)
}

export function backendUnavailableResponse(): NextResponse {
	return jsonError(503, 'AUTH_BACKEND_UNAVAILABLE', 'Сервис авторизации временно недоступен')
}

export function managementUnavailableResponse(): NextResponse {
	return jsonError(503, 'MANAGEMENT_BACKEND_UNAVAILABLE', 'Сервис управления временно недоступен')
}

export async function forwardBffBinaryResponse(upstream: Response): Promise<NextResponse> {
	if (!upstream.ok) {
		const payload = await readJson(upstream)
		const parsedError = errorResponseSchema.safeParse(payload)
		return NextResponse.json(
			parsedError.success
				? parsedError.data
				: errorResponseSchema.parse({ error: { code: upstream.status === 401 ? 'UNAUTHENTICATED' : 'PHOTO_REQUEST_FAILED', message: 'Не удалось получить фотографию' } }),
			{ status: upstream.status, headers: NO_STORE_HEADERS },
		)
	}
	if (!upstream.body) return jsonError(502, 'PHOTO_BACKEND_INVALID_RESPONSE', 'Сервис фотографий вернул пустой ответ')
	const headers = new Headers(NO_STORE_HEADERS)
	for (const name of ['content-type', 'content-length', 'content-disposition']) {
		const value = upstream.headers.get(name)
		if (value) headers.set(name, value)
	}
	headers.set('X-Content-Type-Options', 'nosniff')
	return new NextResponse(upstream.body, { status: upstream.status, headers })
}

export async function getCurrentUser(cookieHeader: string | null | undefined): Promise<{
	status: number
	user: AuthenticatedUser | null
}> {
	const sessionCookie = getSessionCookieHeader(cookieHeader)
	if (!sessionCookie) return { status: 401, user: null }

	try {
		const response = await fetchAuthApi('/api/v1/auth/me', { cookieHeader: sessionCookie })
		const payload = await readJson(response)
		if (!response.ok) return { status: response.status, user: null }
		const parsed = userResponseSchema.safeParse(payload)
		return parsed.success ? { status: 200, user: parsed.data } : { status: 502, user: null }
	} catch {
		return { status: 503, user: null }
	}
}

export async function requireAdminUser(): Promise<AuthenticatedUser> {
	const cookieHeader = (await cookies()).toString()
	const result = await getCurrentUser(cookieHeader)

	if (result.user?.role === 'staff') redirect('/login?error=forbidden')
	if (result.user) return result.user
	if (result.status === 401 || result.status === 403) redirect('/login')
	redirect('/login?error=unavailable')
}

export { adminLoginRequestSchema, browserLoginResponseSchema, logoutResponseSchema, userResponseSchema }

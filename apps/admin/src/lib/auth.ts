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
	if (!path.startsWith(AUTH_API_PREFIX)) throw new Error('Only authentication API paths may be proxied')
	return `${getApiBaseUrl()}${path}`
}

export async function fetchAuthApi(
	path: string,
	options: {
		method?: 'GET' | 'POST'
		body?: string
		cookieHeader?: string | null
		csrfToken?: string | null
		userAgent?: string | null
	} = {},
): Promise<Response> {
	const headers = new Headers({ Accept: 'application/json' })
	if (options.body) headers.set('Content-Type', 'application/json')
	if (options.cookieHeader) headers.set('Cookie', options.cookieHeader)
	if (options.csrfToken) headers.set('X-CSRF-Token', options.csrfToken)
	if (options.userAgent) headers.set('User-Agent', options.userAgent)

	return fetch(getApiUrl(path), {
		method: options.method ?? 'GET',
		headers,
		body: options.body,
		cache: 'no-store',
	})
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

export async function forwardAuthResponse<T>(
	upstream: Response,
	schema: SafeParseSchema<T>,
	options: { forwardSetCookies?: boolean } = {},
): Promise<NextResponse> {
	const payload = await readJson(upstream)

	if (!upstream.ok) {
		const parsedError = errorResponseSchema.safeParse(payload)
		const response = NextResponse.json(
			parsedError.success
				? parsedError.data
				: errorResponseSchema.parse({
						error: {
							code: upstream.status === 401 ? 'UNAUTHENTICATED' : 'AUTH_REQUEST_FAILED',
							message: 'Authentication request failed',
						},
				}),
			{ status: upstream.status, headers: NO_STORE_HEADERS },
		)
		if (options.forwardSetCookies) copyAuthSetCookies(response, upstream)
		return response
	}

	const parsed = schema.safeParse(payload)
	if (!parsed.success) return jsonError(502, 'AUTH_BACKEND_INVALID_RESPONSE', 'Сервис авторизации вернул некорректный ответ')

	const response = NextResponse.json(parsed.data, { status: upstream.status, headers: NO_STORE_HEADERS })
	if (options.forwardSetCookies) copyAuthSetCookies(response, upstream)
	return response
}

export function backendUnavailableResponse(): NextResponse {
	return jsonError(503, 'AUTH_BACKEND_UNAVAILABLE', 'Сервис авторизации временно недоступен')
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

import { afterEach, describe, expect, test } from 'bun:test'
import type { UserResponse } from '@vizaje/contracts'
import { GET as getMe } from '../src/app/api/auth/me/route'
import { POST as login } from '../src/app/api/auth/login/route'
import { POST as logout } from '../src/app/api/auth/logout/route'
import { getCurrentUser, getSessionCookieHeader } from '../src/lib/auth'

const originalFetch = globalThis.fetch
const apiUrl = 'http://127.0.0.1:3000'

function user(role: UserResponse['role'] = 'admin'): UserResponse {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		firstName: 'Test',
		lastName: 'Administrator',
		phone: null,
		email: 'test@example.com',
		role,
		isActive: true,
		storeIds: [],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

function upstreamResponse(status: number, payload: unknown, cookies: string[] = []): Response {
	const headers = new Headers({ 'content-type': 'application/json' })
	for (const cookie of cookies) headers.append('set-cookie', cookie)
	return new Response(JSON.stringify(payload), { status, headers })
}

function request(path: string, init?: RequestInit): Request {
	return new Request(`http://admin.test${path}`, init)
}

function setFetch(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
	globalThis.fetch = implementation as typeof fetch
}

afterEach(() => {
	globalThis.fetch = originalFetch
	delete process.env.VIZAJE_API_URL
})

describe('authentication BFF', () => {
	test('forwards a successful login and only authentication cookies', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		let captured: RequestInit | undefined
		setFetch(async (_input, init) => {
			captured = init
			return upstreamResponse(200, { user: user(), expiresAt: '2026-01-01T08:00:00.000Z' }, [
				'vizaje_session=session-token; Path=/; HttpOnly; SameSite=Lax',
				'vizaje_csrf=csrf-token; Path=/; SameSite=Lax',
				'unrelated=must-not-forward; Path=/',
			])
		})

		const response = await login(request('/api/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'user-agent': 'test-agent' },
			body: JSON.stringify({ email: 'test@example.com', password: 'test-password' }),
		}))

		expect(response.status).toBe(200)
		expect((await response.json()).user.email).toBe('test@example.com')
		expect(response.headers.get('cache-control')).toContain('no-store')
		expect(response.headers.get('set-cookie')).toContain('vizaje_session=session-token')
		expect(response.headers.get('set-cookie')).toContain('vizaje_csrf=csrf-token')
		expect(response.headers.get('set-cookie')).not.toContain('unrelated=')
		expect(new Headers(captured?.headers).get('cookie')).toBeNull()
		expect(new Headers(captured?.headers).get('user-agent')).toBe('test-agent')
	})

	test('returns a generic invalid-credentials response', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		setFetch(async () => upstreamResponse(401, {
			error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
		}))

		const response = await login(request('/api/auth/login', {
			method: 'POST',
			body: JSON.stringify({ email: 'wrong@example.com', password: 'wrong-password' }),
			headers: { 'content-type': 'application/json' },
		}))

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } })
	})

	test('handles backend unavailability without leaking internals', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		setFetch(async () => { throw new Error('connection refused') })

		const response = await login(request('/api/auth/login', {
			method: 'POST',
			body: JSON.stringify({ email: 'test@example.com', password: 'test-password' }),
			headers: { 'content-type': 'application/json' },
		}))

		expect(response.status).toBe(503)
		expect(await response.json()).toEqual({ error: { code: 'AUTH_BACKEND_UNAVAILABLE', message: 'Сервис авторизации временно недоступен' } })
	})

	test('forwards only the session cookie to the profile endpoint', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		let captured: RequestInit | undefined
		setFetch(async (_input, init) => {
			captured = init
			return upstreamResponse(200, user())
		})

		const response = await getMe(request('/api/auth/me', {
			headers: { cookie: 'other=secret; vizaje_session=session-token; vizaje_csrf=csrf-token' },
		}))

		expect(response.status).toBe(200)
		expect((await response.json()).role).toBe('admin')
		expect(new Headers(captured?.headers).get('cookie')).toBe('vizaje_session=session-token')
	})

	test('preserves CSRF enforcement on logout', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		let captured: RequestInit | undefined
		setFetch(async (_input, init) => {
			captured = init
			return upstreamResponse(403, { error: { code: 'CSRF_FAILED', message: 'CSRF validation failed' } })
		})

		const response = await logout(request('/api/auth/logout', {
			method: 'POST',
			headers: { cookie: 'vizaje_session=session-token; vizaje_csrf=csrf-token' },
		}))

		expect(response.status).toBe(403)
		expect(new Headers(captured?.headers).get('cookie')).toBe('vizaje_session=session-token')
		expect(new Headers(captured?.headers).get('x-csrf-token')).toBeNull()
	})

	test('forwards logout and upstream cookie deletion', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		let captured: RequestInit | undefined
		setFetch(async (_input, init) => {
			captured = init
			return upstreamResponse(200, { success: true }, [
				'vizaje_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
				'vizaje_csrf=; Max-Age=0; Path=/; SameSite=Lax',
			])
		})

		const response = await logout(request('/api/auth/logout', {
			method: 'POST',
			headers: { cookie: 'vizaje_session=session-token; vizaje_csrf=csrf-token', 'x-csrf-token': 'csrf-token' },
		}))

		expect(response.status).toBe(200)
		expect((await response.json()).success).toBe(true)
		expect(new Headers(captured?.headers).get('x-csrf-token')).toBe('csrf-token')
		expect(response.headers.get('set-cookie')).toContain('vizaje_session=')
		expect(response.headers.get('set-cookie')).toContain('vizaje_csrf=')
	})
})

describe('server-side session decisions', () => {
	test('returns staff identity for the protected layout to deny', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		setFetch(async () => upstreamResponse(200, user('staff')))

		const result = await getCurrentUser('vizaje_session=staff-session; other=secret')
		expect(result.status).toBe(200)
		expect(result.user?.role).toBe('staff')
	})

	test('treats expired or revoked sessions as unauthenticated', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		setFetch(async () => upstreamResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' } }))

		const result = await getCurrentUser('vizaje_session=expired-session')
		expect(result).toEqual({ status: 401, user: null })
	})

	test('does not forward unrelated cookies', () => {
		expect(getSessionCookieHeader('theme=dark; vizaje_session=session-token; tracking=secret')).toBe('vizaje_session=session-token')
	})
})

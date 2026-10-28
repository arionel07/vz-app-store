import { afterEach, describe, expect, test } from 'bun:test'
import { GET as getEmployees, POST as createEmployee } from '../src/app/api/admin/employees/route'
import { POST as assignStore, DELETE as removeStore } from '../src/app/api/admin/employees/[id]/stores/[storeId]/route'
import { GET as getStores, POST as createStore } from '../src/app/api/admin/stores/route'
import { POST as activate } from '../src/app/api/admin/activation/route'

const originalFetch = globalThis.fetch
const apiUrl = 'http://127.0.0.1:3000'
const userId = '00000000-0000-4000-8000-000000000001'
const storeId = '00000000-0000-4000-8000-000000000002'

const user = {
	id: userId,
	firstName: 'Тест',
	lastName: 'Менеджер',
	phone: '+79991234567',
	email: 'manager@example.com',
	role: 'manager',
	isActive: true,
	storeIds: [storeId],
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
}

const store = {
	id: storeId,
	name: 'Тестовый магазин',
	code: 'TEST-001',
	isActive: true,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
}

function upstream(status: number, payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function request(path: string, init?: RequestInit): Request {
	return new Request(`http://admin.test${path}`, init)
}

afterEach(() => {
	globalThis.fetch = originalFetch
	delete process.env.VIZAJE_API_URL
})

describe('management BFF', () => {
	test('lists employees through an explicit route and forwards only the session cookie', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		let target = ''
		let captured: RequestInit | undefined
		globalThis.fetch = (async (input, init) => {
			target = String(input)
			captured = init
			return upstream(200, { data: [user], pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 } })
		}) as typeof fetch

		const response = await getEmployees(request('/api/admin/employees?search=test', { headers: { cookie: 'vizaje_session=session; tracking=secret' } }))
		expect(response.status).toBe(200)
		expect(target).toContain('/api/v1/users?')
		expect(target).toContain('search=test')
		expect(new Headers(captured?.headers).get('cookie')).toBe('vizaje_session=session')
		expect(new Headers(captured?.headers).get('x-csrf-token')).toBeNull()
		expect(response.headers.get('cache-control')).toContain('no-store')
	})

	test('validates employee creation and forwards CSRF to the API', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		let captured: RequestInit | undefined
		globalThis.fetch = (async (_input, init) => {
			captured = init
			return upstream(201, { ...user, role: 'staff', email: null, phone: '+79991234568', storeIds: [] })
		}) as typeof fetch

		const response = await createEmployee(request('/api/admin/employees', {
			method: 'POST',
			headers: { cookie: 'vizaje_session=session; vizaje_csrf=csrf', 'x-csrf-token': 'csrf' },
			body: JSON.stringify({ firstName: 'Новый', lastName: 'Сотрудник', phone: '+79991234568', email: null, role: 'staff', isActive: true, storeIds: [] }),
		}))
		expect(response.status).toBe(201)
		expect(new Headers(captured?.headers).get('cookie')).toBe('vizaje_session=session')
		expect(new Headers(captured?.headers).get('x-csrf-token')).toBe('csrf')
		expect(JSON.parse(String(captured?.body)).firstName).toBe('Новый')

		const invalid = await createEmployee(request('/api/admin/employees', { method: 'POST', body: JSON.stringify({ role: 'staff' }) }))
		expect(invalid.status).toBe(400)
	})

	test('keeps store routes and membership routes explicit', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		const targets: string[] = []
		globalThis.fetch = (async (input) => {
			targets.push(String(input))
			if (String(input).includes('/stores?')) return upstream(200, { data: [store], pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 } })
			return upstream(200, user)
		}) as typeof fetch

		await getStores(request('/api/admin/stores', { headers: { cookie: 'vizaje_session=session' } }))
		await assignStore(request(`/api/admin/employees/${userId}/stores/${storeId}`, { method: 'POST', headers: { cookie: 'vizaje_session=session', 'x-csrf-token': 'csrf' } }), { params: Promise.resolve({ id: userId, storeId }) })
		await removeStore(request(`/api/admin/employees/${userId}/stores/${storeId}`, { method: 'DELETE', headers: { cookie: 'vizaje_session=session', 'x-csrf-token': 'csrf' } }), { params: Promise.resolve({ id: userId, storeId }) })
		await createStore(request('/api/admin/stores', { method: 'POST', headers: { cookie: 'vizaje_session=session', 'x-csrf-token': 'csrf' }, body: JSON.stringify({ name: store.name, code: store.code, isActive: true }) }))

		expect(targets.some((target) => target.includes('/api/v1/stores?'))).toBe(true)
		expect(targets.some((target) => target.endsWith(`/api/v1/users/${userId}/stores/${storeId}`))).toBe(true)
		expect(targets.some((target) => target.endsWith('/api/v1/stores'))).toBe(true)
	})

	test('forwards activation and preserves safe error responses', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		let captured: RequestInit | undefined
		globalThis.fetch = (async (_input, init) => {
			captured = init
			return upstream(201, { activationId: storeId, activationPayload: 'vizaje://activate?secret=one-time', expiresAt: '2026-01-01T00:05:00.000Z' })
		}) as typeof fetch

		const response = await activate(request('/api/admin/activation', {
			method: 'POST',
			headers: { cookie: 'vizaje_session=session; vizaje_csrf=csrf', 'x-csrf-token': 'csrf' },
			body: JSON.stringify({ userId, storeId }),
		}))
		expect(response.status).toBe(201)
		expect(new Headers(captured?.headers).get('cookie')).toBe('vizaje_session=session')
		expect(new Headers(captured?.headers).get('x-csrf-token')).toBe('csrf')

		globalThis.fetch = (async (_input: RequestInfo | URL) => upstream(403, { error: { code: 'CSRF_FAILED', message: 'CSRF validation failed' } })) as typeof fetch
		const forbidden = await activate(request('/api/admin/activation', { method: 'POST', headers: { cookie: 'vizaje_session=session' }, body: JSON.stringify({ userId, storeId }) }))
		expect(forbidden.status).toBe(403)
		expect(await forbidden.json()).toEqual({ error: { code: 'CSRF_FAILED', message: 'CSRF validation failed' } })

		globalThis.fetch = (async (_input: RequestInfo | URL) => upstream(500, 'upstream unavailable')) as typeof fetch
		const unavailable = await activate(request('/api/admin/activation', { method: 'POST', headers: { cookie: 'vizaje_session=session' }, body: JSON.stringify({ userId, storeId }) }))
		expect(unavailable.status).toBe(500)
		expect(await unavailable.json()).toEqual({ error: { code: 'MANAGEMENT_REQUEST_FAILED', message: 'Запрос управления не выполнен' } })
	})
})

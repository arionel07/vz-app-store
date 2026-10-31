import { afterEach, describe, expect, test } from 'bun:test'
import { GET as getOverview } from '../src/app/api/admin/reports/overview/route'
import { GET as getStores } from '../src/app/api/admin/reports/stores/route'

const originalFetch = globalThis.fetch
const storeId = '00000000-0000-4000-8000-000000000001'
const apiOrigin = 'http://127.0.0.1:3000'

function request(path: string, headers?: HeadersInit): Request {
	return new Request(`http://admin.test${path}`, { headers })
}

function response(status: number, payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

const reportPeriod = {
	preset: 'custom',
	startDate: '2026-01-01',
	endDate: '2026-01-02',
	startAt: '2025-12-31T22:00:00.000Z',
	endAt: '2026-01-01T22:00:00.000Z',
	endExclusive: true,
	timezone: 'Europe/Chisinau',
	snapshotAt: '2026-01-03T00:00:00.000Z',
}

afterEach(() => {
	globalThis.fetch = originalFetch
	delete process.env.VIZAJE_API_URL
})

describe('reporting BFF', () => {
	test('requires the existing session, forwards only that cookie and validates/forwards approved report filters', async () => {
		process.env.VIZAJE_API_URL = apiOrigin
		let target = ''
		let forwardedHeaders: Headers | undefined
		globalThis.fetch = (async (input, init) => {
			target = String(input)
			forwardedHeaders = new Headers(init?.headers)
			return response(200, {
				period: reportPeriod,
				metrics: { activeStoreCount: 0, activeAssignedEmployeeCount: 0, participatingStoreCount: 0, assignedTaskCount: 0, checkedTaskCount: 0, outstandingReviewCount: 0, taskCompletionRate: null },
			})
		}) as typeof fetch

		const result = await getOverview(request(`/api/admin/reports/overview?period=custom&startDate=2026-01-01&endDate=2026-01-02&storeId=${storeId}&timezone=Europe%2FChisinau&unapproved=https%3A%2F%2Fevil.test`, { cookie: 'vizaje_session=session-secret; vizaje_csrf=csrf-secret; tracking=not-forwarded' }))
		expect(result.status).toBe(200)
		expect(target).toContain('/api/v1/management/reports/overview?')
		expect(target).toContain(`storeId=${storeId}`)
		expect(target).toContain('timezone=Europe%2FChisinau')
		expect(target).not.toContain('unapproved')
		expect(forwardedHeaders?.get('cookie')).toBe('vizaje_session=session-secret')
		expect(forwardedHeaders?.get('x-csrf-token')).toBeNull()
		expect(result.headers.get('cache-control')).toContain('no-store')
		expect(result.headers.get('vary')).toContain('Cookie')
		expect(await result.json()).toMatchObject({ metrics: { activeStoreCount: 0, taskCompletionRate: null } })
	})

	test('validates store pagination and preserves API 403 scope failures without making invalid requests', async () => {
		process.env.VIZAJE_API_URL = apiOrigin
		let calls = 0
		globalThis.fetch = (async (input) => {
			calls += 1
			if (String(input).includes('storeId=00000000')) return response(403, { error: { code: 'FORBIDDEN', message: 'Недостаточно прав' } })
			return response(200, { period: reportPeriod, data: [], pagination: { page: 2, pageSize: 20, total: 0, totalPages: 0 } })
		}) as typeof fetch

		const invalid = await getStores(request('/api/admin/reports/stores?page=0&pageSize=101', { cookie: 'vizaje_session=session' }))
		expect(invalid.status).toBe(400)
		expect(calls).toBe(0)

		const listing = await getStores(request(`/api/admin/reports/stores?page=2&pageSize=20&period=custom&startDate=2026-01-01&endDate=2026-01-02&storeId=${storeId}`, { cookie: 'vizaje_session=session' }))
		expect(listing.status).toBe(403)
		expect(await listing.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Недостаточно прав' } })
		expect(listing.headers.get('cache-control')).toContain('no-store')
		expect(calls).toBe(1)
	})

	test('passes missing-session rejection from the API and maps backend unavailability safely', async () => {
		process.env.VIZAJE_API_URL = apiOrigin
		let captured: Headers | undefined
		globalThis.fetch = (async (_input, init) => {
			captured = new Headers(init?.headers)
			return response(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } })
		}) as typeof fetch
		const unauthenticated = await getOverview(request('/api/admin/reports/overview'))
		expect(unauthenticated.status).toBe(401)
		expect(captured?.has('cookie')).toBe(false)
		expect(unauthenticated.headers.get('cache-control')).toContain('no-store')

		globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => { throw new Error('network unavailable') }) as unknown as typeof fetch
		const unavailable = await getOverview(request('/api/admin/reports/overview', { cookie: 'vizaje_session=session' }))
		expect(unavailable.status).toBe(503)
		expect(await unavailable.json()).toMatchObject({ error: { code: 'MANAGEMENT_BACKEND_UNAVAILABLE' } })
	})

	test('rejects malformed filter values before contacting the API', async () => {
		process.env.VIZAJE_API_URL = apiOrigin
		let called = false
		globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => { called = true; return response(200, {}) }) as typeof fetch
		const invalid = await getOverview(request('/api/admin/reports/overview?period=custom&startDate=2026-02-30&endDate=2026-03-01'))
		expect(invalid.status).toBe(400)
		expect(called).toBe(false)
	})
})

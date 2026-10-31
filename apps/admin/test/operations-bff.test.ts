import { afterEach, describe, expect, test } from 'bun:test'
import { GET as listCampaigns, POST as createCampaign } from '../src/app/api/admin/operations/campaigns/route'
import { PATCH as updateIssue } from '../src/app/api/admin/operations/issues/[id]/route'
import { POST as changePriority } from '../src/app/api/admin/operations/issues/[id]/priority/route'
import { POST as decideRequest } from '../src/app/api/admin/operations/requests/[id]/decision/route'
import { GET as getEvidence } from '../src/app/api/admin/operations/evidence/[kind]/[recordId]/[photoId]/route'

const originalFetch = globalThis.fetch
const apiUrl = 'http://127.0.0.1:3000'
const id = '00000000-0000-4000-8000-000000000001'
const storeId = '00000000-0000-4000-8000-000000000002'
const now = '2026-10-31T10:00:00.000Z'
const campaign = { id, title: 'Выкладка', description: '', status: 'draft', startsAt: now, endsAt: '2026-11-01T10:00:00.000Z', timezone: 'Europe/Chisinau', storeIds: [storeId], referencePhotoIds: [], requiredActions: [], requiresPhoto: false, executions: [{ id: storeId, storeId, status: 'not_started', submittedAt: null, reviewComment: null }], createdAt: now }

function request(path: string, init?: RequestInit): Request { return new Request(`http://admin.test${path}`, init) }
function json(status: number, body: unknown): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }

afterEach(() => { globalThis.fetch = originalFetch; delete process.env.VIZAJE_API_URL })

describe('Retail Operations Admin BFF', () => {
	test('validates and forwards campaign creation with session-only cookies and CSRF', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		let target = ''
		let init: RequestInit | undefined
		globalThis.fetch = (async (input, options) => { target = String(input); init = options; return json(201, campaign) }) as typeof fetch
		const response = await createCampaign(request('/api/admin/operations/campaigns', {
			method: 'POST', headers: { cookie: 'vizaje_session=session-secret; vizaje_csrf=csrf-cookie; tracking=private', 'x-csrf-token': 'csrf-header' },
			body: JSON.stringify({ title: 'Выкладка', startsAt: now, endsAt: '2026-11-01T10:00:00.000Z', timezone: 'Europe/Chisinau', storeIds: [storeId] }),
		}))
		expect(response.status).toBe(201)
		expect(target).toBe(`${apiUrl}/api/v1/management/operations/campaigns`)
		expect(new Headers(init?.headers).get('cookie')).toBe('vizaje_session=session-secret')
		expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-header')
		expect(new Headers(init?.headers).get('idempotency-key')).toBeNull()
		expect(response.headers.get('cache-control')).toContain('no-store')
		expect(JSON.parse(String(init?.body)).title).toBe('Выкладка')
	})

	test('rejects invalid mutation input before contacting the API', async () => {
		let called = false
		globalThis.fetch = (async () => { called = true; return json(200, {}) }) as unknown as typeof fetch
		const response = await updateIssue(request(`/api/admin/operations/issues/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'teleported' }) }), { params: Promise.resolve({ id }) })
		expect(response.status).toBe(400)
		expect(called).toBe(false)
	})

	test('forwards issue priority and request decisions only through their explicit CSRF routes', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		const targets: string[] = []
		let init: RequestInit | undefined
		globalThis.fetch = (async (input, options) => {
			targets.push(String(input)); init = options
			if (String(input).endsWith('/priority')) return json(200, { id, storeId, category: 'lighting', title: 'Лампа', description: 'Не горит', priority: 'high', photoIds: [], reporterId: storeId, assignedTo: null, status: 'open', resolutionNotes: null, createdAt: now, updatedAt: now, resolvedAt: null })
			return json(200, { id, status: 'rejected', comment: 'Недостаточно данных' })
		}) as typeof fetch
		const priorityResponse = await changePriority(request(`/api/admin/operations/issues/${id}/priority`, { method: 'POST', headers: { cookie: 'vizaje_session=session; tracking=secret', 'x-csrf-token': 'csrf' }, body: JSON.stringify({ priority: 'high', expectedPriority: 'normal' }) }), { params: Promise.resolve({ id }) })
		expect(priorityResponse.status).toBe(200)
		expect(new Headers(init?.headers).get('cookie')).toBe('vizaje_session=session')
		expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf')
		const invalidDecision = await decideRequest(request(`/api/admin/operations/requests/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) }), { params: Promise.resolve({ id }) })
		expect(invalidDecision.status).toBe(400)
		const decision = await decideRequest(request(`/api/admin/operations/requests/${id}/decision`, { method: 'POST', headers: { cookie: 'vizaje_session=session', 'x-csrf-token': 'csrf' }, body: JSON.stringify({ decision: 'rejected', comment: 'Недостаточно данных' }) }), { params: Promise.resolve({ id }) })
		expect(decision.status).toBe(200)
		expect(targets).toEqual([`${apiUrl}/api/v1/management/operations/issues/${id}/priority`, `${apiUrl}/api/v1/management/operations/requests/${id}/decision`])
	})

	test('preserves backend authorization and concurrency errors without caching', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		globalThis.fetch = (async () => json(409, { error: { code: 'REVIEW_TRANSITION_INVALID', message: 'Запись уже обработана' } })) as unknown as typeof fetch
		const response = await listCampaigns(request('/api/admin/operations/campaigns?page=1', { headers: { cookie: 'vizaje_session=session' } }))
		expect(response.status).toBe(409)
		expect(response.headers.get('cache-control')).toContain('no-store')
		expect((await response.json()).error.code).toBe('REVIEW_TRANSITION_INVALID')
		globalThis.fetch = (async () => json(403, { error: { code: 'STORE_FORBIDDEN', message: 'Нет доступа к магазину' } })) as unknown as typeof fetch
		const forbidden = await listCampaigns(request('/api/admin/operations/campaigns?page=1', { headers: { cookie: 'vizaje_session=session' } }))
		expect(forbidden.status).toBe(403)
		expect((await forbidden.json()).error.code).toBe('STORE_FORBIDDEN')
	})

	test('streams private evidence through the scoped API and never exposes storage URLs', async () => {
		process.env.VIZAJE_API_URL = apiUrl
		let target = ''
		let init: RequestInit | undefined
		globalThis.fetch = (async (input, options) => { target = String(input); init = options; return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } }) }) as typeof fetch
		const response = await getEvidence(request('/api/admin/operations/evidence/store_issue/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000004', { headers: { cookie: 'vizaje_session=session; tracking=secret' } }), { params: Promise.resolve({ kind: 'store_issue', recordId: '00000000-0000-4000-8000-000000000003', photoId: '00000000-0000-4000-8000-000000000004' }) })
		expect(response.status).toBe(200)
		expect(target).toContain('/api/v1/operations/evidence/store_issue/')
		expect(new Headers(init?.headers).get('cookie')).toBe('vizaje_session=session')
		expect(response.headers.get('cache-control')).toContain('no-store')
		expect(response.headers.get('content-type')).toContain('image/png')
		expect(await response.text()).not.toContain('storageKey')
	})
})

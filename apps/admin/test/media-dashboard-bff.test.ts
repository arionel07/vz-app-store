import { afterEach, describe, expect, test } from 'bun:test'
import { GET as getPhotos } from '../src/app/api/admin/photos/route'
import { DELETE as deletePhoto } from '../src/app/api/admin/photos/[id]/route'
import { GET as getImage } from '../src/app/api/admin/photos/[id]/image/route'
import { GET as getOverview } from '../src/app/api/admin/dashboard/overview/route'
import { GET as getPhotoDashboard } from '../src/app/api/admin/dashboard/photos/route'
import { GET as getQuizDashboard } from '../src/app/api/admin/dashboard/quizzes/route'

const originalFetch = globalThis.fetch
const photoId = '00000000-0000-4000-8000-000000000001'
const storeId = '00000000-0000-4000-8000-000000000002'
const userId = '00000000-0000-4000-8000-000000000003'
const period = { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' }

function upstream(status: number, payload: unknown): Response {
	const body = payload instanceof Uint8Array ? payload as unknown as BodyInit : JSON.stringify(payload)
	return new Response(body, { status, headers: { 'content-type': payload instanceof Uint8Array ? 'image/png' : 'application/json' } })
}

function request(path: string, init?: RequestInit): Request { return new Request(`http://admin.test${path}`, init) }
function basePeriod() { return { ...period, endExclusive: true, timezone: 'UTC' as const } }

afterEach(() => { globalThis.fetch = originalFetch; delete process.env.VIZAJE_API_URL })

describe('media and dashboard BFF', () => {
	test('forwards scoped photo filters and only the session cookie', async () => {
		process.env.VIZAJE_API_URL = 'http://127.0.0.1:3000'
		let target = ''; let captured: RequestInit | undefined
		globalThis.fetch = (async (input, init) => { target = String(input); captured = init; return upstream(200, { data: [{ id: photoId, storeId, uploadedBy: userId, originalFilename: 'a.png', mimeType: 'image/png', fileSize: 3, createdAt: '2026-01-15T00:00:00.000Z' }], pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1 } }) }) as typeof fetch
		const response = await getPhotos(request(`/api/admin/photos?storeId=${storeId}&uploadedBy=${userId}&startDate=${period.start}&endDate=${period.end}`, { headers: { cookie: 'vizaje_session=session; tracking=secret' } }))
		expect(response.status).toBe(200); expect(target).toContain(`/api/v1/photos?`); expect(target).toContain(`uploadedBy=${userId}`); expect(new Headers(captured?.headers).get('cookie')).toBe('vizaje_session=session'); expect(response.headers.get('cache-control')).toContain('no-store')
	})

	test('streams private image bytes and preserves CSRF for admin deletion', async () => {
		process.env.VIZAJE_API_URL = 'http://127.0.0.1:3000'
		const targets: string[] = []; let captured: RequestInit | undefined
		globalThis.fetch = (async (input, init) => { targets.push(String(input)); captured = init; return String(input).includes(`/api/v1/photos/${photoId}`) && init?.method === 'GET' ? new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '3' } }) : new Response(null, { status: 204 }) }) as typeof fetch
		const image = await getImage(request(`/api/admin/photos/${photoId}/image`, { headers: { cookie: 'vizaje_session=session' } }), { params: Promise.resolve({ id: photoId }) })
		expect(image.status).toBe(200); expect(image.headers.get('cache-control')).toContain('no-store'); expect(image.headers.get('x-content-type-options')).toBe('nosniff'); expect(new Uint8Array(await image.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]))
		const deleted = await deletePhoto(request(`/api/admin/photos/${photoId}`, { method: 'DELETE', headers: { cookie: 'vizaje_session=session', 'x-csrf-token': 'csrf' } }), { params: Promise.resolve({ id: photoId }) })
		expect(deleted.status).toBe(204); expect(new Headers(captured?.headers).get('x-csrf-token')).toBe('csrf'); expect(targets.some((target) => target.endsWith(`/api/v1/photos/${photoId}`))).toBe(true)
	})

	test('keeps dashboard routes explicit, typed and no-store', async () => {
		process.env.VIZAJE_API_URL = 'http://127.0.0.1:3000'; const targets: string[] = []
		globalThis.fetch = (async (input) => { const target = String(input); targets.push(target); if (target.includes('/overview')) return upstream(200, { period: basePeriod(), metrics: { activeEmployeeCount: 1, publishedQuizCount: 2, completedAttemptCount: 3, completedEmployeeCount: 1, averageCompletedAttemptScore: null, passRate: null, uploadedPhotoCount: 4 } }); if (target.includes('/dashboard/photos')) return upstream(200, { period: basePeriod(), totalPhotoCount: 0, dailyUploads: [], perStoreUploads: [], distinctUploadingEmployeeCount: 0 }); return upstream(200, { period: basePeriod(), summary: { completedAttemptCount: 0, participatingEmployeeCount: 0, averageScore: null, passRate: null }, data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }) }) as typeof fetch
		for (const route of [getOverview, getPhotoDashboard, getQuizDashboard]) { const response = await route(request(`/api/admin/dashboard/overview?startDate=${period.start}&endDate=${period.end}`)); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store') }
		expect(targets.some((target) => target.includes('/api/v1/dashboard/overview'))).toBe(true); expect(targets.some((target) => target.includes('/api/v1/dashboard/photos'))).toBe(true); expect(targets.some((target) => target.includes('/api/v1/dashboard/quizzes'))).toBe(true)
	})
})

import { afterEach, describe, expect, test } from 'bun:test'
import { GET as getQuizzes, POST as createQuiz } from '../src/app/api/admin/quizzes/route'
import { PUT as saveDraft } from '../src/app/api/admin/quizzes/[id]/draft/route'
import { POST as publishQuiz } from '../src/app/api/admin/quizzes/[id]/publish/route'
import { GET as getResults } from '../src/app/api/admin/quizzes/[id]/results/route'
import { GET as getReviews } from '../src/app/api/admin/quiz-reviews/route'
import { POST as reviewAnswer } from '../src/app/api/admin/quiz-reviews/[attemptId]/questions/[questionId]/route'

const originalFetch = globalThis.fetch
const quizId = '00000000-0000-4000-8000-000000000001'
const revisionId = '00000000-0000-4000-8000-000000000002'
const userId = '00000000-0000-4000-8000-000000000003'
const storeId = '00000000-0000-4000-8000-000000000004'

const quiz = {
	id: quizId,
	revisionId,
	revisionNumber: 1,
	status: 'draft',
	revisionStatus: 'draft',
	title: 'Тестовый квиз',
	description: null,
	passingScore: 70,
	assignmentMode: 'selected',
	storeIds: [storeId],
	questions: [],
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

describe('quiz management BFF', () => {
	test('keeps quiz listing explicit and forwards only the session cookie', async () => {
		process.env.VIZAJE_API_URL = 'http://127.0.0.1:3000'
		let target = ''
		let captured: RequestInit | undefined
		globalThis.fetch = (async (input, init) => {
			target = String(input)
			captured = init
			return upstream(200, { data: [quiz], pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 } })
		}) as typeof fetch

		const response = await getQuizzes(request('/api/admin/quizzes?status=draft&search=test', { headers: { cookie: 'vizaje_session=session; tracking=secret' } }))
		expect(response.status).toBe(200)
		expect(target).toContain('/api/v1/management/quizzes?')
		expect(target).toContain('status=draft')
		expect(new Headers(captured?.headers).get('cookie')).toBe('vizaje_session=session')
		expect(response.headers.get('cache-control')).toContain('no-store')
	})

	test('validates draft input and preserves CSRF on write routes', async () => {
		process.env.VIZAJE_API_URL = 'http://127.0.0.1:3000'
		let captured: RequestInit | undefined
		globalThis.fetch = (async (_input, init) => {
			captured = init
			return upstream(200, quiz)
		}) as typeof fetch

		const response = await saveDraft(request(`/api/admin/quizzes/${quizId}/draft`, {
			method: 'PUT',
			headers: { cookie: 'vizaje_session=session; vizaje_csrf=csrf', 'x-csrf-token': 'csrf' },
			body: JSON.stringify({ title: 'Тестовый квиз', description: null, passingScore: 70, assignmentMode: 'selected', storeIds: [storeId], questions: [] }),
		}), { params: Promise.resolve({ id: quizId }) })
		expect(response.status).toBe(200)
		expect(new Headers(captured?.headers).get('cookie')).toBe('vizaje_session=session')
		expect(new Headers(captured?.headers).get('x-csrf-token')).toBe('csrf')

		const invalid = await createQuiz(request('/api/admin/quizzes', { method: 'POST', body: JSON.stringify({ title: '', passingScore: 120, assignmentMode: 'all' }) }))
		expect(invalid.status).toBe(400)
	})

	test('keeps publishing and results routes typed and explicit', async () => {
		process.env.VIZAJE_API_URL = 'http://127.0.0.1:3000'
		const targets: string[] = []
		globalThis.fetch = (async (input) => {
			targets.push(String(input))
			if (String(input).includes('/results?')) return upstream(200, { data: [], pagination: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
			return upstream(200, quiz)
		}) as typeof fetch

		await publishQuiz(request(`/api/admin/quizzes/${quizId}/publish`, { method: 'POST', headers: { cookie: 'vizaje_session=session', 'x-csrf-token': 'csrf' } }), { params: Promise.resolve({ id: quizId }) })
		const results = await getResults(request(`/api/admin/quizzes/${quizId}/results?status=submitted`), { params: Promise.resolve({ id: quizId }) })
		expect(results.status).toBe(200)
		expect(targets.some((target) => target.includes(`/api/v1/management/quizzes/${quizId}/publish`))).toBe(true)
		expect(targets.some((target) => target.includes(`/api/v1/management/quizzes/${quizId}/results?`) && target.includes('status=submitted'))).toBe(true)

		const invalidId = await getResults(request('/api/admin/quizzes/not-a-uuid/results'), { params: Promise.resolve({ id: 'not-a-uuid' }) })
		expect(invalidId.status).toBe(400)
	})

	test('keeps manual review routes explicit and CSRF-protected', async () => {
		process.env.VIZAJE_API_URL = 'http://127.0.0.1:3000'
		const attemptId = '00000000-0000-4000-8000-000000000005'
		const questionId = '00000000-0000-4000-8000-000000000006'
		let target = ''
		let captured: RequestInit | undefined
		globalThis.fetch = (async (input, init) => {
			target = String(input)
			captured = init
			if (init?.method === 'POST') return upstream(200, { attemptId, questionId, status: 'reviewed', awardedPoints: 2, maxPoints: 3, reviewerId: userId, feedback: null, reviewedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' })
			return upstream(200, { data: [{ attemptId, questionId, status: 'pending', awardedPoints: null, maxPoints: 3, reviewerId: null, feedback: null, reviewedAt: null, createdAt: '2026-01-01T00:00:00.000Z', userId, userName: 'Тест Сотрудник', quizId, questionPrompt: 'Текст' }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })
		}) as typeof fetch
		const list = await getReviews(request('/api/admin/quiz-reviews?status=pending', { headers: { cookie: 'vizaje_session=session' } }))
		expect(list.status).toBe(200)
		expect(target).toContain('/api/v1/management/quiz-reviews?')
		const reviewed = await reviewAnswer(request(`/api/admin/quiz-reviews/${attemptId}/questions/${questionId}`, { method: 'POST', headers: { cookie: 'vizaje_session=session; vizaje_csrf=csrf', 'x-csrf-token': 'csrf' }, body: JSON.stringify({ awardedPoints: 2, feedback: null }) }), { params: Promise.resolve({ attemptId, questionId }) })
		expect(reviewed.status).toBe(200)
		expect(target).toContain(`/api/v1/management/quiz-attempts/${attemptId}/questions/${questionId}/review`)
		expect(new Headers(captured?.headers).get('x-csrf-token')).toBe('csrf')
	})
})

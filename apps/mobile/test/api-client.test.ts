import { afterEach, describe, expect, test } from 'bun:test'
import { getAvailableQuiz, getCurrentUser, listAvailableQuizzes, listMyAttempts, redeemActivation, startQuizAttempt, submitQuizAttempt } from '../src/api/client'

const originalFetch = globalThis.fetch
const user = {
	id: '11111111-1111-4111-8111-111111111111', firstName: 'Тест', lastName: 'Сотрудник', phone: '+70000000000', email: null,
	role: 'staff' as const, isActive: true, storeIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}
const quiz = {
	id: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', revisionNumber: 1,
	title: 'Тест', description: null, passingScore: 70,
	questions: [{ id: '33333333-3333-4333-8333-333333333333', prompt: 'Вопрос', position: 0, options: [{ id: '44444444-4444-4444-8444-444444444444', label: 'Ответ', position: 0 }] }],
}
const attempt = {
	id: '55555555-5555-4555-8555-555555555555', quizId: quiz.id, revisionId: quiz.revisionId, revisionNumber: 1,
	status: 'submitted' as const, startedAt: '2026-01-01T00:00:00.000Z', submittedAt: '2026-01-01T00:01:00.000Z', scorePercent: 100, passed: true, quiz,
}

describe('mobile API client', () => {
	afterEach(() => { globalThis.fetch = originalFetch })

	test('does not retry one-time activation redemption', async () => {
		let calls = 0
		globalThis.fetch = (async (_input, init) => {
			calls += 1
			expect(init?.method).toBe('POST')
			return new Response(JSON.stringify({ error: { code: 'INVALID_ACTIVATION', message: 'invalid' } }), { status: 401 })
		}) as typeof fetch
		await expect(redeemActivation('secret', 'device-a')).rejects.toMatchObject({ status: 401, code: 'INVALID_ACTIVATION' })
		expect(calls).toBe(1)
	})

	test('forwards bearer credentials and validates the profile response', async () => {
		globalThis.fetch = (async (_input, init) => {
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token', Accept: 'application/json' })
			return new Response(JSON.stringify(user), { status: 200 })
		}) as typeof fetch
		expect(await getCurrentUser('access-token')).toEqual(user)
	})

	test('normalizes backend unavailability without exposing transport details', async () => {
		let calls = 0
		globalThis.fetch = (async () => {
			calls += 1
			throw new Error('private transport detail')
		}) as unknown as typeof fetch
		await expect(getCurrentUser('access-token')).rejects.toMatchObject({ status: 0, code: 'NETWORK_UNAVAILABLE', message: 'Сервис временно недоступен' })
		expect(calls).toBe(2)
	})

	test('uses staff quiz and attempt endpoints with shared response validation', async () => {
		const urls: string[] = []
		globalThis.fetch = (async (input, init) => {
			urls.push(String(input))
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token' })
			if (String(input).includes('/api/v1/quizzes?')) return new Response(JSON.stringify({ data: [quiz], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }))
			if (String(input).includes('/api/v1/quizzes/111')) return new Response(JSON.stringify(quiz))
			return new Response(JSON.stringify({ data: [attempt], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }))
		}) as typeof fetch
		expect((await listAvailableQuizzes('access-token')).data[0]?.title).toBe('Тест')
		expect((await getAvailableQuiz('access-token', quiz.id)).revisionId).toBe(quiz.revisionId)
		expect((await listMyAttempts('access-token')).data[0]?.passed).toBe(true)
		expect(urls).toHaveLength(3)
	})

	test('does not retry attempt creation or submission', async () => {
		let calls = 0
		globalThis.fetch = (async (_input, init) => {
			calls += 1
			expect(init?.method).toBe('POST')
			return new Response(JSON.stringify({ error: { code: 'SERVER_UNAVAILABLE', message: 'unavailable' } }), { status: 503 })
		}) as typeof fetch
		await expect(startQuizAttempt('access-token', quiz.id)).rejects.toMatchObject({ status: 503 })
		await expect(submitQuizAttempt('access-token', attempt.id, { answers: [{ questionId: quiz.questions[0].id, optionId: quiz.questions[0].options[0].id }] })).rejects.toMatchObject({ status: 503 })
		expect(calls).toBe(2)
	})
})

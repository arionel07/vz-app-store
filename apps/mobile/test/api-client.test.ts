import { afterEach, describe, expect, test } from 'bun:test'
import { acknowledgeKnowledgeArticle, createOperationIssue, createOperationRequest, getAvailableQuiz, getCurrentUser, getOperationCampaignHistory, getOperationInspection, getMyProfile, getNotificationUnreadCount, listKnowledgeArticles, listMyNotifications, listAvailableQuizzes, listMyAttempts, listMyOperationIssues, listMyOperationRequests, listOperationCampaigns, listOperationDisplays, mobileLogin, operationEvidencePath, redeemActivation, registerPushDevice, resolveApiOrigin, startQuizAttempt, submitOperationCampaign, submitOperationInspection, submitQuizAttempt, uploadPhoto, uploadQuizAnswerPhoto } from '../src/api/client'
import { mobileLoginErrorMessage } from '../src/auth/login-errors'

process.env.EXPO_PUBLIC_API_URL ??= 'http://127.0.0.1:3000'
process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP ??= 'true'

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
const photo = {
	id: '66666666-6666-4666-8666-666666666666', storeId: '77777777-7777-4777-8777-777777777777', uploadedBy: user.id,
	originalFilename: 'photo.jpg', mimeType: 'image/jpeg' as const, fileSize: 1234, createdAt: '2026-01-01T00:00:00.000Z',
}

describe('mobile API client', () => {
	afterEach(() => { globalThis.fetch = originalFetch })

	test('does not retry one-time activation redemption', async () => {
		let calls = 0
		globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
			calls += 1
			expect(init?.method).toBe('POST')
			return new Response(JSON.stringify({ error: { code: 'INVALID_ACTIVATION', message: 'invalid' } }), { status: 401 })
		}) as typeof fetch
		await expect(redeemActivation('secret', 'device-a')).rejects.toMatchObject({ status: 401, code: 'INVALID_ACTIVATION' })
		expect(calls).toBe(1)
	})

	test('logs mobile staff in with the device id and does not retry credentials', async () => {
		let calls = 0
		globalThis.fetch = (async (_input, init) => {
			calls += 1
			expect(init?.method).toBe('POST')
			expect(JSON.parse(String(init?.body))).toEqual({ email: 'staff@example.com', password: 'private-password', deviceId: 'device-a' })
			return new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'invalid' } }), { status: 401 })
		}) as typeof fetch
		await expect(mobileLogin('staff@example.com', 'private-password', 'device-a')).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })
		expect(calls).toBe(1)
	})

	test('returns a validated session after successful mobile login', async () => {
		const response = {
			accessToken: 'access-token',
			expiresAt: '2026-10-28T12:00:00.000Z',
			maxExpiresAt: '2026-12-28T12:00:00.000Z',
			user,
		}
		globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
			expect(init?.method).toBe('POST')
			return new Response(JSON.stringify(response), { status: 201 })
		}) as unknown as typeof fetch
		expect(await mobileLogin('staff@example.com', 'private-password', 'device-a')).toEqual(response)
	})

	test('keeps invalid email and password errors generic', async () => {
		globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'invalid' } }), { status: 401 })) as unknown as typeof fetch
		for (const credentials of [
			{ email: 'staff@example.com', password: 'wrong-password' },
			{ email: 'unknown@example.com', password: 'private-password' },
		]) {
			let error: unknown
			try {
				await mobileLogin(credentials.email, credentials.password, 'device-a')
			} catch (caught) {
				error = caught
			}
			expect(error).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })
			expect(mobileLoginErrorMessage(error)).toBe('Не удалось войти. Проверьте email и пароль.')
		}
	})

	test('distinguishes network failures and server rate limiting', async () => {
		globalThis.fetch = (async () => { throw new Error('network unavailable') }) as unknown as typeof fetch
		let networkError: unknown
		try {
			await mobileLogin('staff@example.com', 'private-password', 'device-a')
		} catch (caught) {
			networkError = caught
		}
		expect(networkError).toMatchObject({ status: 0, code: 'NETWORK_UNAVAILABLE' })
		expect(mobileLoginErrorMessage(networkError)).toBe('Не удалось связаться с сервером. Проверьте подключение и повторите попытку.')

		globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'limited' } }), { status: 429 })) as unknown as typeof fetch
		let limitedError: unknown
		try {
			await mobileLogin('staff@example.com', 'private-password', 'device-a')
		} catch (caught) {
			limitedError = caught
		}
		expect(limitedError).toMatchObject({ status: 429, code: 'RATE_LIMITED' })
		expect(mobileLoginErrorMessage(limitedError)).toBe('Слишком много попыток. Повторите вход позже.')
	})

	test('forwards bearer credentials and validates the profile response', async () => {
		globalThis.fetch = (async (_input, init) => {
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token', Accept: 'application/json' })
			return new Response(JSON.stringify(user), { status: 200 })
		}) as typeof fetch
		expect(await getCurrentUser('access-token')).toEqual(user)
	})

	test('loads the redacted employee profile through the mobile endpoint', async () => {
		const profile = {
			userId: user.id,
			jobTitle: 'Консультант',
			employmentStartedOn: '2025-02-03',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		}
		globalThis.fetch = (async (input, init) => {
			expect(String(input)).toContain('/api/v1/me/profile')
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token', Accept: 'application/json' })
			return new Response(JSON.stringify(profile), { status: 200 })
		}) as typeof fetch
		expect(await getMyProfile('access-token')).toEqual(profile)
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

	test('requires an explicit API origin instead of assuming localhost', async () => {
		const configured = process.env.EXPO_PUBLIC_API_URL
		delete process.env.EXPO_PUBLIC_API_URL
		try {
			await expect(getCurrentUser('access-token')).rejects.toMatchObject({ status: 0, code: 'API_URL_REQUIRED' })
		} finally {
			if (configured === undefined) delete process.env.EXPO_PUBLIC_API_URL
			else process.env.EXPO_PUBLIC_API_URL = configured
		}
	})

	test('allows an explicitly enabled private LAN HTTP origin only in development', () => {
		expect(resolveApiOrigin('http://192.168.0.16:3000', { development: true, allowInsecureHttp: true })).toBe('http://192.168.0.16:3000')
		expect(() => resolveApiOrigin('http://192.168.0.16:3000', { development: true, allowInsecureHttp: false })).toThrow()
		expect(() => resolveApiOrigin('http://192.168.0.16:3000', { development: false, allowInsecureHttp: true })).toThrow()
		expect(() => resolveApiOrigin('http://8.8.8.8:3000', { development: true, allowInsecureHttp: true })).toThrow()
	})

	test('always accepts HTTPS and rejects HTTP in production', () => {
		expect(resolveApiOrigin('https://staging-api.example.com', { development: false, allowInsecureHttp: false })).toBe('https://staging-api.example.com')
		expect(() => resolveApiOrigin('http://127.0.0.1:3000', { development: false, allowInsecureHttp: true })).toThrow()
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

	test('uploads one multipart file with bearer and idempotency headers without overriding the boundary', async () => {
		globalThis.fetch = (async (_input, init) => {
			expect(init?.method).toBe('POST')
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token', Accept: 'application/json', 'Idempotency-Key': 'photo-key-1' })
			expect(Object.keys(init?.headers as Record<string, string>)).not.toContain('Content-Type')
			expect(init?.body).toBeInstanceOf(FormData)
			return new Response(JSON.stringify(photo), { status: 201 })
		}) as typeof fetch
		expect(await uploadPhoto('access-token', photo.storeId, { uri: 'file:///photo.jpg', name: 'photo.jpg', type: 'image/jpeg' }, 'photo-key-1')).toEqual(photo)
	})

	test('does not silently retry a failed photo upload', async () => {
		let calls = 0
		globalThis.fetch = (async () => {
			calls += 1
			return new Response(JSON.stringify({ error: { code: 'SERVER_UNAVAILABLE', message: 'unavailable' } }), { status: 503 })
		}) as unknown as typeof fetch
		await expect(uploadPhoto('access-token', photo.storeId, { uri: 'file:///photo.jpg', name: 'photo.jpg', type: 'image/jpeg' }, 'photo-key-2')).rejects.toMatchObject({ status: 503 })
		expect(calls).toBe(1)
	})

	test('uploads a quiz answer photo through its explicit attempt route', async () => {
		globalThis.fetch = (async (input, init) => {
			expect(String(input)).toContain(`/api/v1/attempts/${attempt.id}/questions/${quiz.questions[0].id}/photo`)
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token', 'Idempotency-Key': 'quiz-photo-key' })
			expect(init?.body).toBeInstanceOf(FormData)
			return new Response(JSON.stringify(photo), { status: 201 })
		}) as typeof fetch
		expect(await uploadQuizAnswerPhoto('access-token', attempt.id, quiz.questions[0].id, { uri: 'file:///answer.jpg', name: 'answer.jpg', type: 'image/jpeg' }, 'quiz-photo-key')).toEqual(photo)
	})

	test('uses typed inbox, unread count and device registration endpoints', async () => {
		const notification = { id: '88888888-8888-4888-8888-888888888888', eventType: 'task.assigned', category: 'task' as const, title: 'Новое задание', body: 'Проверьте полку', target: { kind: 'task' as const, id: quiz.id }, requiresAcknowledgement: false, readAt: null, acknowledgedAt: null, createdAt: '2026-01-01T00:00:00.000Z' }
		globalThis.fetch = (async (input, init) => {
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token' })
			if (String(input).includes('unread-count')) return new Response(JSON.stringify({ count: 1 }))
			if (String(input).includes('push-devices')) return new Response(JSON.stringify({ id: '99999999-9999-4999-8999-999999999999', deviceId: 'device-a', platform: 'ios', createdAt: notification.createdAt, lastSeenAt: notification.createdAt }), { status: 201 })
			return new Response(JSON.stringify({ data: [notification], pagination: { page: 1, pageSize: 30, total: 1, totalPages: 1 }, unreadCount: 1 }))
		}) as typeof fetch
		expect((await listMyNotifications('access-token')).data[0]?.target?.kind).toBe('task')
		expect(await getNotificationUnreadCount('access-token')).toEqual({ count: 1 })
		expect((await registerPushDevice('access-token', { deviceId: 'device-a', platform: 'ios', expoPushToken: 'ExponentPushToken[test]' })).platform).toBe('ios')
	})

	test('uses scoped knowledge list and acknowledgement endpoints', async () => {
		const articleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
		globalThis.fetch = (async (input, init) => {
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token' })
			if (String(input).includes('/knowledge/articles?')) return new Response(JSON.stringify({ data: [{ id: articleId, category: { id: quiz.id, name: 'Продукция', slug: 'produkciya', description: null, parentId: null, sortOrder: 1, isActive: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, title: 'Материал', summary: null, requiresAcknowledgement: true, acknowledgedAt: null, publishedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }))
			return new Response(JSON.stringify({ articleId, revisionId: quiz.revisionId, acknowledgedAt: '2026-01-01T00:00:00.000Z' }))
		}) as typeof fetch
		expect((await listKnowledgeArticles('access-token')).data[0]?.title).toBe('Материал')
		expect((await acknowledgeKnowledgeArticle('access-token', articleId)).articleId).toBe(articleId)
	})

	test('loads all operation lists only through authenticated employee-scoped endpoints', async () => {
		const storeId = '77777777-7777-4777-8777-777777777777'
		const urls: string[] = []
		globalThis.fetch = (async (input, init) => {
			urls.push(String(input))
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token' })
			return new Response(JSON.stringify({ data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }))
		}) as typeof fetch
		expect((await listOperationCampaigns('access-token', { storeId })).data).toEqual([])
		expect((await listOperationDisplays('access-token', storeId)).data).toEqual([])
		expect((await listMyOperationIssues('access-token', storeId)).data).toEqual([])
		expect((await listMyOperationRequests('access-token', storeId)).data).toEqual([])
		expect(urls).toHaveLength(4)
		expect(urls.every((url) => url.includes(`storeId=${storeId}`))).toBe(true)
		expect(urls.some((url) => url.includes('/api/v1/management/'))).toBe(false)
	})

	test('sends campaign and merchandising submissions once with validated idempotency payloads', async () => {
		const recordId = '11111111-1111-4111-8111-111111111111'
		const storeId = '77777777-7777-4777-8777-777777777777'
		const photoId = '66666666-6666-4666-8666-666666666666'
		const secondPhotoId = '55555555-5555-4555-8555-555555555555'
		let calls = 0
		globalThis.fetch = (async (input, init) => {
			calls += 1
			expect(init?.method).toBe('POST')
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token' })
			const body = JSON.parse(String(init?.body))
			if (String(input).includes('/campaigns/')) {
				expect(String(input)).toContain(`/campaigns/${recordId}/stores/${storeId}/submit`)
				expect(body).toMatchObject({ employeeNote: 'Проверено', idempotencyKey: 'campaign-key-1', photoIds: [photoId, secondPhotoId] })
				return new Response(JSON.stringify({ id: recordId, status: 'submitted', submittedAt: '2026-01-01T00:00:00.000Z', version: 1 }))
			}
			expect(String(input)).toContain(`/merchandising/displays/${recordId}/inspections`)
			expect(body).toMatchObject({ employeeNote: 'Выкладка проверена', actualPhotoId: photoId, idempotencyKey: 'inspection-key-1' })
			return new Response(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', displayId: recordId, status: 'submitted', version: 1, submittedAt: '2026-01-01T00:00:00.000Z' }), { status: 201 })
		}) as typeof fetch
		await submitOperationCampaign('access-token', recordId, storeId, { actionResults: [true], photoIds: [photoId, secondPhotoId], employeeNote: 'Проверено', idempotencyKey: 'campaign-key-1' })
		await submitOperationInspection('access-token', recordId, { actualPhotoId: photoId, checklistResults: [true], employeeNote: 'Выкладка проверена', idempotencyKey: 'inspection-key-1' })
		expect(calls).toBe(2)
	})

	test('creates issues and requests with stable Idempotency-Key headers and typed responses', async () => {
		const storeId = '77777777-7777-4777-8777-777777777777'
		const reporterId = user.id
		const issueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
		const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
		const photoIds = ['66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555']
		let calls = 0
		globalThis.fetch = (async (input, init) => {
			calls += 1
			expect(init?.method).toBe('POST')
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token', 'Idempotency-Key': calls === 1 ? 'issue-key-123' : 'request-key-123' })
			const body = JSON.parse(String(init?.body))
			const now = '2026-01-01T00:00:00.000Z'
			if (String(input).endsWith('/issues')) {
				expect(body.photoIds).toEqual(photoIds)
				return new Response(JSON.stringify({ id: issueId, storeId, category: 'equipment', title: 'Свет', description: 'Не работает', priority: 'normal', photoIds, reporterId, assignedTo: null, status: 'open', resolutionNotes: null, createdAt: now, updatedAt: now, resolvedAt: null }), { status: 201 })
			}
			expect(body.attachmentPhotoIds).toEqual(photoIds)
			return new Response(JSON.stringify({ id: requestId, storeId, category: 'supplies', description: 'Перчатки', quantity: null, attachmentPhotoIds: photoIds, requesterId: reporterId, assignedTo: null, status: 'submitted', decisionComment: null, createdAt: now, updatedAt: now }), { status: 201 })
		}) as typeof fetch
		expect((await createOperationIssue('access-token', { storeId, category: 'equipment', title: 'Свет', description: 'Не работает', priority: 'normal', photoIds }, 'issue-key-123')).id).toBe(issueId)
		expect((await createOperationRequest('access-token', { storeId, category: 'supplies', description: 'Перчатки', attachmentPhotoIds: photoIds }, 'request-key-123')).id).toBe(requestId)
		expect(calls).toBe(2)
	})

	test('maps operation permission/conflict/network failures and builds a private evidence route', async () => {
		const id = '11111111-1111-4111-8111-111111111111'
		expect(operationEvidencePath('store_issue', id, 'photo/a')).toBe(`/api/v1/operations/evidence/store_issue/${id}/photo%2Fa`)
		globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 'STORE_FORBIDDEN', message: 'no' } }), { status: 403 })) as unknown as typeof fetch
		await expect(listMyOperationIssues('access-token', '77777777-7777-4777-8777-777777777777')).rejects.toMatchObject({ status: 403 })
		globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'conflict' } }), { status: 409 })) as unknown as typeof fetch
		await expect(createOperationRequest('access-token', { storeId: '77777777-7777-4777-8777-777777777777', category: 'other', description: 'Запрос', attachmentPhotoIds: [] }, 'request-key-123')).rejects.toMatchObject({ status: 409 })
	})

	test('resolves operation notification targets through authorized typed detail/history APIs', async () => {
		const id = '11111111-1111-4111-8111-111111111111'
		const now = '2026-01-01T00:00:00.000Z'
		globalThis.fetch = (async (input, init) => {
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token' })
			if (String(input).endsWith(`/merchandising/inspections/${id}`)) return new Response(JSON.stringify({ id, displayId: '22222222-2222-4222-8222-222222222222', displayName: 'Витрина', brand: 'Марка', storeId: photo.storeId, referencePhotoId: photo.id, actualPhotoId: null, checklist: [], checklistResults: [], status: 'submitted', submittedBy: user.id, reviewerId: null, comment: null, employeeNote: 'Готово', active: true, currentDisplay: { name: 'Витрина', brand: 'Марка', referencePhotoId: photo.id, checklist: [], active: true }, version: 1, submittedAt: now, reviewedAt: null, createdAt: now, updatedAt: now }))
			return new Response(JSON.stringify({ data: [{ id: '33333333-3333-4333-8333-333333333333', executionId: id, actorId: user.id, action: 'submitted', comment: 'Проверено', version: 1, createdAt: now }] }))
		}) as typeof fetch
		expect((await getOperationInspection('access-token', id)).employeeNote).toBe('Готово')
		expect((await getOperationCampaignHistory('access-token', id)).data[0]?.comment).toBe('Проверено')
	})
})

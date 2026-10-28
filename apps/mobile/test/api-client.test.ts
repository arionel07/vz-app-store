import { afterEach, describe, expect, test } from 'bun:test'
import { getCurrentUser, redeemActivation } from '../src/api/client'

const originalFetch = globalThis.fetch
const user = {
	id: '11111111-1111-4111-8111-111111111111', firstName: 'Тест', lastName: 'Сотрудник', phone: '+70000000000', email: null,
	role: 'staff' as const, isActive: true, storeIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
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
})

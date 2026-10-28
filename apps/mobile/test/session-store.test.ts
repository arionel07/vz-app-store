import { describe, expect, test } from 'bun:test'
import { createSessionStore, createSingleFlight, type SecureStorage, type StoredSession } from '../src/auth/session-store'

const session: StoredSession = {
	accessToken: 'token-a',
	expiresAt: '2026-10-28T12:00:00.000Z',
	maxExpiresAt: '2026-12-28T12:00:00.000Z',
	deviceId: 'device-a',
	user: {
		id: '11111111-1111-4111-8111-111111111111', firstName: 'Тест', lastName: 'Сотрудник', phone: '+70000000000', email: null,
		role: 'staff', isActive: true, storeIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
	},
}

class MemoryStorage implements SecureStorage {
	values = new Map<string, string>()
	failKey: string | null = null
	async getItem(key: string) { return this.values.get(key) ?? null }
	async setItem(key: string, value: string) { if (key === this.failKey) throw new Error('write failed'); this.values.set(key, value) }
	async deleteItem(key: string) { this.values.delete(key) }
}

describe('secure session store', () => {
	test('persists and restores a validated session', async () => {
		const storage = new MemoryStorage()
		const store = createSessionStore(storage)
		await store.persist(session)
		expect(await store.read()).toEqual(session)
		expect(storage.values.has('vizaje.mobile.session.pending')).toBe(false)
	})

	test('keeps a pending rotated token recoverable if the primary write fails', async () => {
		const storage = new MemoryStorage()
		const store = createSessionStore(storage)
		storage.failKey = 'vizaje.mobile.session'
		await expect(store.persist(session)).rejects.toThrow()
		expect((await store.read())?.accessToken).toBe('token-a')
	})

	test('shares one in-flight renewal between concurrent callers', async () => {
		let calls = 0
		let resolve: ((value: string) => void) | undefined
		const flight = createSingleFlight(() => {
			calls += 1
			return new Promise<string>((done) => { resolve = done })
		})
		const first = flight()
		const second = flight()
		expect(first).toBe(second)
		expect(calls).toBe(1)
		resolve?.('rotated')
		expect(await first).toBe('rotated')
	})
})

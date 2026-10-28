import { mobileSessionResponseSchema, type MobileSessionResponse } from '@vizaje/contracts'

export const SESSION_STORAGE_KEY = 'vizaje.mobile.session'
export const PENDING_SESSION_STORAGE_KEY = 'vizaje.mobile.session.pending'
export const DEVICE_ID_STORAGE_KEY = 'vizaje.mobile.device-id'

export type StoredSession = MobileSessionResponse & { deviceId: string }

export interface SecureStorage {
	getItem(key: string): Promise<string | null>
	setItem(key: string, value: string): Promise<void>
	deleteItem(key: string): Promise<void>
}

function decodeSession(value: string | null): StoredSession | null {
	if (!value) return null
	try {
		const parsed: unknown = JSON.parse(value)
		if (typeof parsed !== 'object' || parsed === null || !('deviceId' in parsed)) return null
		const session = mobileSessionResponseSchema.safeParse(parsed)
		if (!session.success || typeof parsed.deviceId !== 'string' || parsed.deviceId.trim().length === 0) return null
		return { ...session.data, deviceId: parsed.deviceId }
	} catch {
		return null
	}
}

export function createSessionStore(storage: SecureStorage) {
	const readSlot = async (key: string) => decodeSession(await storage.getItem(key))

	return {
		async read(): Promise<StoredSession | null> {
			return (await readSlot(PENDING_SESSION_STORAGE_KEY)) ?? (await readSlot(SESSION_STORAGE_KEY))
		},
		async persist(session: StoredSession): Promise<void> {
			const serialized = JSON.stringify(session)
			await storage.setItem(PENDING_SESSION_STORAGE_KEY, serialized)
			const pending = await readSlot(PENDING_SESSION_STORAGE_KEY)
			if (!pending || pending.accessToken !== session.accessToken) throw new Error('Session pending write could not be verified')
			await storage.setItem(SESSION_STORAGE_KEY, serialized)
			const primary = await readSlot(SESSION_STORAGE_KEY)
			if (!primary || primary.accessToken !== session.accessToken) throw new Error('Session write could not be verified')
			await storage.deleteItem(PENDING_SESSION_STORAGE_KEY)
		},
		async clear(): Promise<void> {
			await storage.deleteItem(PENDING_SESSION_STORAGE_KEY)
			await storage.deleteItem(SESSION_STORAGE_KEY)
		},
	}
}

export function createSingleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
	let inFlight: Promise<T> | null = null
	return () => {
		if (!inFlight) {
			const current = operation()
			const tracked = current.finally(() => {
				if (inFlight === tracked) inFlight = null
			})
			inFlight = tracked
		}
		return inFlight
	}
}

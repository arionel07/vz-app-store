import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import {
	getCurrentUser,
	isNetworkError,
	listStores,
	mobileLogin as mobileLoginRequest,
	logoutMobileSession,
	redeemActivation as redeemActivationRequest,
	renewMobileSession,
	ApiError,
} from '../api/client'
import {
	createSessionStore,
	DEVICE_ID_STORAGE_KEY,
	type SecureStorage,
	type StoredSession,
} from './session-store'
import type { MobileSessionResponse, StoreResponse, UserResponse } from '@vizaje/contracts'

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'offline' | 'storage-error'
export type LoginSubmissionStatus = 'idle' | 'submitting'

export type AuthenticatedUser = UserResponse & { assignedStores: StoreResponse[] }

type LogoutResult = { remoteRevoked: boolean; localCleared: boolean }

type AuthContextValue = {
	status: AuthStatus
	loginSubmissionStatus: LoginSubmissionStatus
	user: AuthenticatedUser | null
	errorMessage: string | null
	redeemActivation: (secret: string) => Promise<void>
	loginMobile: (email: string, password: string) => Promise<void>
	retryRestore: () => Promise<void>
	logout: () => Promise<LogoutResult>
	requestAuthenticated: <T>(request: (token: string) => Promise<T>, options?: { retryUnauthorized?: boolean }) => Promise<T>
}

class StorageError extends Error {
	readonly name = 'StorageError'
}

const secureStorage: SecureStorage = {
	getItem: (key) => SecureStore.getItemAsync(key),
	setItem: (key, value) => SecureStore.setItemAsync(key, value),
	deleteItem: (key) => SecureStore.deleteItemAsync(key),
}

const sessionStore = createSessionStore(secureStorage)
const AuthContext = createContext<AuthContextValue | null>(null)

function userDisplayStores(user: UserResponse, stores: StoreResponse[]): StoreResponse[] {
	const assigned = new Set(user.storeIds)
	return stores.filter((store) => assigned.has(store.id) && store.isActive)
}

function isUnauthorized(error: unknown): error is ApiError {
	return error instanceof ApiError && error.status === 401
}

function messageForRestore(error: unknown): string {
	if (error instanceof StorageError) return 'Не удалось безопасно сохранить сессию. Повторите попытку.'
	if (isNetworkError(error)) return 'Нет соединения с сервером. Данные доступа сохранены на устройстве.'
	return 'Не удалось проверить сессию. Повторите попытку.'
}

export function AuthProvider({ children }: PropsWithChildren) {
	const [status, setStatus] = useState<AuthStatus>('loading')
	const [loginSubmissionStatus, setLoginSubmissionStatus] = useState<LoginSubmissionStatus>('idle')
	const [user, setUser] = useState<AuthenticatedUser | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const sessionRef = useRef<StoredSession | null>(null)
	const deviceIdRef = useRef<string | null>(null)
	const renewalRef = useRef<Promise<StoredSession> | null>(null)

	const getDeviceId = useCallback(async (): Promise<string> => {
		if (deviceIdRef.current) return deviceIdRef.current
		const stored = await secureStorage.getItem(DEVICE_ID_STORAGE_KEY)
		if (stored?.trim()) {
			deviceIdRef.current = stored
			return stored
		}
		const generated = Crypto.randomUUID()
		await secureStorage.setItem(DEVICE_ID_STORAGE_KEY, generated)
		deviceIdRef.current = generated
		return generated
	}, [])

	const persistSession = useCallback(async (session: StoredSession) => {
		// Keep the fresh token in memory before the two-slot write. This lets the
		// app recover the rotated session if the process is interrupted mid-write.
		sessionRef.current = session
		try {
			await sessionStore.persist(session)
		} catch {
			setStatus('storage-error')
			throw new StorageError('Session storage failed')
		}
	}, [])

	const loadProfile = useCallback(async (token: string): Promise<AuthenticatedUser> => {
		const profile = await getCurrentUser(token)
		const stores = await listStores(token)
		return { ...profile, assignedStores: userDisplayStores(profile, stores.data) }
	}, [])

	const establishMobileSession = useCallback(async (response: MobileSessionResponse, deviceId: string) => {
		const next: StoredSession = { ...response, deviceId }
		await persistSession(next)
		const profile = await loadProfile(next.accessToken)
		setUser(profile)
		setStatus('authenticated')
	}, [loadProfile, persistSession])

	const renewCurrentSession = useCallback(async (): Promise<StoredSession> => {
		if (renewalRef.current) return renewalRef.current
		const current = sessionRef.current
		if (!current) throw new ApiError(401, 'UNAUTHENTICATED', 'Сессия не найдена')

		const operation = (async () => {
			const next = await renewMobileSession(current.accessToken)
			const rotated: StoredSession = { ...next, deviceId: current.deviceId }
			await persistSession(rotated)
			return rotated
		})()
		const tracked = operation.finally(() => {
			if (renewalRef.current === tracked) renewalRef.current = null
		})
		renewalRef.current = tracked
		return tracked
	}, [persistSession])

	const clearLocalSession = useCallback(async () => {
		sessionRef.current = null
		setUser(null)
		try {
			await sessionStore.clear()
			return true
		} catch {
			setStatus('storage-error')
			return false
		}
	}, [])

	const restore = useCallback(async () => {
		setStatus('loading')
		setErrorMessage(null)
		let stored: StoredSession | null
		try {
			stored = await sessionStore.read()
		} catch {
			setStatus('storage-error')
			setErrorMessage('Не удалось прочитать защищённую сессию на устройстве.')
			return
		}
		if (!stored) {
			setStatus('unauthenticated')
			return
		}
		sessionRef.current = stored
		try {
			const profile = await loadProfile(stored.accessToken)
			setUser(profile)
			setStatus('authenticated')
		} catch (error) {
			if (isUnauthorized(error)) {
				try {
					const renewed = await renewCurrentSession()
					const profile = await loadProfile(renewed.accessToken)
					setUser(profile)
					setStatus('authenticated')
					return
				} catch (renewError) {
					if (isUnauthorized(renewError)) {
						await clearLocalSession()
						setStatus('unauthenticated')
						return
					}
					error = renewError
				}
			}
			setErrorMessage(messageForRestore(error))
			setStatus(isNetworkError(error) ? 'offline' : error instanceof StorageError ? 'storage-error' : 'offline')
		}
	}, [clearLocalSession, loadProfile, renewCurrentSession])

	useEffect(() => {
		void restore()
	}, [restore])

	const redeemActivation = useCallback(async (secret: string) => {
		setErrorMessage(null)
		try {
			const deviceId = await getDeviceId()
			const response = await redeemActivationRequest(secret, deviceId)
			await establishMobileSession(response, deviceId)
		} catch (error) {
			if (isUnauthorized(error)) {
				await clearLocalSession()
				setStatus('unauthenticated')
				throw error
			}
			setErrorMessage(messageForRestore(error))
			throw error
		}
	}, [clearLocalSession, establishMobileSession, getDeviceId])

	const loginMobile = useCallback(async (email: string, password: string) => {
		setLoginSubmissionStatus('submitting')
		setErrorMessage(null)
		try {
			const deviceId = await getDeviceId()
			const response = await mobileLoginRequest(email, password, deviceId)
			await establishMobileSession(response, deviceId)
		} catch (error) {
			if (error instanceof StorageError) {
				setStatus('storage-error')
				setErrorMessage('Не удалось безопасно сохранить сессию. Повторите попытку.')
			} else {
				setErrorMessage(isNetworkError(error) ? 'Нет соединения с сервером. Проверьте подключение и повторите попытку.' : 'Не удалось выполнить вход. Проверьте данные и повторите попытку.')
			}
			throw error
		} finally {
			setLoginSubmissionStatus('idle')
		}
	}, [establishMobileSession, getDeviceId])

	const logout = useCallback(async (): Promise<LogoutResult> => {
		const current = sessionRef.current
		let remoteRevoked = false
		if (current) {
			try {
				await logoutMobileSession(current.accessToken)
				remoteRevoked = true
			} catch {
				// Local logout still happens. The caller can tell the employee that
				// remote revocation could not be confirmed.
			}
		}
		const localCleared = await clearLocalSession()
		if (localCleared) setStatus('unauthenticated')
		return { remoteRevoked, localCleared }
	}, [clearLocalSession])

	const requestAuthenticated = useCallback(async <T,>(request: (token: string) => Promise<T>, options: { retryUnauthorized?: boolean } = {}): Promise<T> => {
		const current = sessionRef.current
		if (!current) throw new ApiError(401, 'UNAUTHENTICATED', 'Сессия не найдена')
		try {
			return await request(current.accessToken)
		} catch (error) {
			if (!isUnauthorized(error)) throw error
			if (options.retryUnauthorized === false) {
				await clearLocalSession()
				setStatus('unauthenticated')
				throw error
			}
			try {
				const renewed = await renewCurrentSession()
				return await request(renewed.accessToken)
			} catch (renewError) {
				if (isUnauthorized(renewError)) {
					await clearLocalSession()
					setStatus('unauthenticated')
				}
				throw renewError
			}
		}
	}, [clearLocalSession, renewCurrentSession])

	const value = useMemo<AuthContextValue>(() => ({
		status,
		loginSubmissionStatus,
		user,
		errorMessage,
		redeemActivation,
		loginMobile,
		retryRestore: restore,
		logout,
		requestAuthenticated,
	}), [errorMessage, loginMobile, loginSubmissionStatus, logout, redeemActivation, requestAuthenticated, restore, status, user])

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
	const value = useContext(AuthContext)
	if (!value) throw new Error('useAuth must be used inside AuthProvider')
	return value
}

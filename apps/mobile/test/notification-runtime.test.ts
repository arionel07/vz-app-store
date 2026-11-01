import { describe, expect, test } from 'bun:test'
import type { NotificationResponse } from 'expo-notifications'
import { startNotificationBridge, supportsNativeNotifications } from '../src/notifications/notification-runtime'

function fakeNotifications(lastResponse: NotificationResponse | null = null) {
	const calls: string[] = []
	let responseListener: ((response: NotificationResponse) => void) | undefined
	const api = {
		setNotificationHandler: () => { calls.push('set-handler') },
		addNotificationResponseReceivedListener: (listener: (response: NotificationResponse) => void) => {
			calls.push('subscribe')
			responseListener = listener
			return { remove: () => { calls.push('remove') } }
		},
		getLastNotificationResponseAsync: async () => {
			calls.push('get-last-response')
			return lastResponse
		},
	}
	return { api, calls, emit: (response: NotificationResponse) => responseListener?.(response) }
}

const response = {
	notification: { request: { identifier: 'response-1', content: { data: { target: { kind: 'schedule' } } } } },
} as unknown as NotificationResponse

describe('notification platform runtime', () => {
	test('never invokes Expo notification APIs on Web', () => {
		const fake = fakeNotifications(response)
		const onResponse = () => { fake.calls.push('handle-response') }

		const cleanup = startNotificationBridge('web', fake.api, onResponse)
		cleanup()

		expect(supportsNativeNotifications('web')).toBe(false)
		expect(fake.calls).toEqual([])
	})

	test.each(['ios', 'android'] as const)('registers listeners and handles initial/tapped responses on %s', async (platform) => {
		const fake = fakeNotifications(response)
		const handled: NotificationResponse[] = []
		const cleanup = startNotificationBridge(platform, fake.api, (value) => handled.push(value))

		await Promise.resolve()
		fake.emit(response)
		expect(supportsNativeNotifications(platform)).toBe(true)
		expect(fake.calls).toEqual(['set-handler', 'subscribe', 'get-last-response'])
		expect(handled).toEqual([response, response])

		cleanup()
		expect(fake.calls.at(-1)).toBe('remove')
	})

	test('keeps one foreground handler while re-subscribing after auth-state changes', () => {
		const fake = fakeNotifications()
		const cleanupLoading = startNotificationBridge('ios', fake.api, () => undefined)
		cleanupLoading()
		const cleanupAuthenticated = startNotificationBridge('ios', fake.api, () => undefined)
		cleanupAuthenticated()

		expect(fake.calls.filter((call) => call === 'set-handler')).toHaveLength(1)
		expect(fake.calls.filter((call) => call === 'subscribe')).toHaveLength(2)
		expect(fake.calls.filter((call) => call === 'remove')).toHaveLength(2)
	})

	test('does not deliver a last response after native listener cleanup', async () => {
		let resolveLastResponse: ((value: NotificationResponse | null) => void) | undefined
		const fake = fakeNotifications()
		fake.api.getLastNotificationResponseAsync = () => new Promise((resolve) => { resolveLastResponse = resolve })
		const handled: NotificationResponse[] = []
		const cleanup = startNotificationBridge('ios', fake.api, (value) => handled.push(value))

		cleanup()
		resolveLastResponse?.(response)
		await Promise.resolve()

		expect(handled).toEqual([])
		expect(fake.calls.at(-1)).toBe('remove')
	})
})

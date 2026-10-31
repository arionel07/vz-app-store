import { describe, expect, test } from 'bun:test'
import { authRedirect, goBackOrReplace, type SafeNavigation } from '../src/navigation/safe-navigation'
import { notificationTargetHref } from '../src/notifications/navigation'

function navigation(canGoBack: boolean) {
	const actions: string[] = []
	const value: SafeNavigation = {
		canGoBack: () => canGoBack,
		back: () => actions.push('back'),
		replace: (href) => actions.push(`replace:${href}`),
	}
	return { value, actions }
}

describe('mobile navigation safety', () => {
	test('replaces instead of dispatching GO_BACK when there is no history', () => {
		const state = navigation(false)
		goBackOrReplace(state.value, '/(tabs)')
		expect(state.actions).toEqual(['replace:/(tabs)'])
	})

	test('uses the native back action only when history exists', () => {
		const state = navigation(true)
		goBackOrReplace(state.value, '/(tabs)')
		expect(state.actions).toEqual(['back'])
	})

	test('redirects an unauthenticated protected route to activation', () => {
		expect(authRedirect('unauthenticated', undefined)).toBe('/activation')
		expect(authRedirect('unauthenticated', '(tabs)')).toBe('/activation')
		expect(authRedirect('unauthenticated', 'profile')).toBe('/activation')
		expect(authRedirect('unauthenticated', 'operations')).toBe('/activation')
	})

	test('opens authenticated initial navigation at home', () => {
		expect(authRedirect('authenticated', undefined)).toBe('/(tabs)')
	})

	test('redirects an authenticated activation route home without an activation loop', () => {
		expect(authRedirect('authenticated', 'activation')).toBe('/(tabs)')
		expect(authRedirect('authenticated', 'activate')).toBe('/(tabs)')
		expect(authRedirect('unauthenticated', 'activation')).toBeNull()
		expect(authRedirect('authenticated', '(tabs)')).toBeNull()
	})

	test('keeps the unauthenticated entry stable after logout', () => {
		expect(authRedirect('unauthenticated', '(tabs)')).toBe('/activation')
		expect(authRedirect('unauthenticated', 'activation')).toBeNull()
	})

	test('does not replace the activation screen while login is pending', () => {
		// Login submission is local state; the auth guard must continue rendering
		// the unauthenticated activation route until a session is established.
		expect(authRedirect('unauthenticated', 'activation')).toBeNull()
	})

	test('keeps notification deep links on an explicit allowlist', () => {
		expect(notificationTargetHref({ kind: 'task', id: '11111111-1111-4111-8111-111111111111' })).toBe('/task/11111111-1111-4111-8111-111111111111')
		expect(notificationTargetHref({ kind: 'photo_report', id: '11111111-1111-4111-8111-111111111111' })).toBe('/(tabs)/photos')
		expect(notificationTargetHref({ kind: 'announcement', id: '11111111-1111-4111-8111-111111111111' })).toBe('/announcement/11111111-1111-4111-8111-111111111111')
	expect(notificationTargetHref({ kind: 'knowledge', id: '11111111-1111-4111-8111-111111111111' })).toBe('/knowledge/11111111-1111-4111-8111-111111111111')
		expect(notificationTargetHref({ kind: 'operation', id: '11111111-1111-4111-8111-111111111111' })).toBe('/operations/record/11111111-1111-4111-8111-111111111111')
		expect(authRedirect('unauthenticated', 'operations')).toBe('/activation')
		expect(authRedirect('unauthenticated', 'notifications')).toBe('/activation')
		expect(authRedirect('authenticated', 'announcement')).toBeNull()
	})
})

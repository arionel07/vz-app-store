import { describe, expect, test } from 'bun:test'
import { authRedirect, goBackOrReplace, type SafeNavigation } from '../src/navigation/safe-navigation'

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
})

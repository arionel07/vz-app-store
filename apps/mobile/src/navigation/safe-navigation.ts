import type { Href } from 'expo-router'

export type NavigationHref = Href

export type SafeNavigation = {
	canGoBack: () => boolean
	back: () => void
	replace: (href: NavigationHref) => void
}

export function goBackOrReplace(navigation: SafeNavigation, fallback: NavigationHref): void {
	if (navigation.canGoBack()) {
		navigation.back()
		return
	}
	navigation.replace(fallback)
}

export type AuthNavigationStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'offline' | 'storage-error'

export function authRedirect(status: AuthNavigationStatus, segment: string | undefined): NavigationHref | null {
	const protectedRoute = segment === '(tabs)' || segment === 'profile' || segment === 'schedule' || segment === 'tasks' || segment === 'task' || segment === 'quiz' || segment === 'attempt'
	const activationRoute = segment === 'activation' || segment === 'activate'
	if (status === 'unauthenticated' && !segment) return '/activation'
	if (status === 'authenticated' && !segment) return '/(tabs)'
	if (status === 'unauthenticated' && protectedRoute) return '/activation'
	if (status === 'authenticated' && activationRoute) return '/(tabs)'
	return null
}

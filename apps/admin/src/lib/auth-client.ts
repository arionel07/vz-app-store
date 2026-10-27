import { CSRF_COOKIE_NAME } from './auth-constants'

export function getBrowserCookie(name: string): string | null {
	if (typeof document === 'undefined') return null

	const encoded = document.cookie
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))

	if (!encoded) return null
	return decodeURIComponent(encoded.slice(name.length + 1))
}

export function getBrowserCsrfToken(): string | null {
	return getBrowserCookie(CSRF_COOKIE_NAME)
}

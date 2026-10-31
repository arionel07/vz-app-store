import type { ActivationPayload } from '@vizaje/contracts'
export { parseActivationPayload } from '@vizaje/contracts'
export type { ActivationPayload } from '@vizaje/contracts'

function normalizePath(pathname: string): string {
	return pathname.replace(/\/+$/, '') || '/'
}

/** Ignore ordinary app/browser URLs; only activation-intent URLs should affect the entry screen. */
export function isActivationUrlCandidate(value: string, linkBaseUrl?: string): boolean {
	try {
		const url = new URL(value.trim())
		if (url.protocol === 'vizaje:') return url.hostname === 'activate'
		if (!linkBaseUrl?.trim()) return false
		const base = new URL(linkBaseUrl.trim())
		return url.origin === base.origin && normalizePath(url.pathname) === normalizePath(base.pathname)
	} catch {
		return false
	}
}

/** Keeps repeated OS link events from presenting or redeeming the same secret twice. */
export function createActivationLinkGate() {
	const seenSecrets = new Set<string>()
	return (payload: ActivationPayload): boolean => {
		if (seenSecrets.has(payload.secret)) return false
		seenSecrets.add(payload.secret)
		return true
	}
}

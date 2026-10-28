export type ActivationPayload =
	| { source: 'custom'; activationId: string; secret: string }
	| { source: 'link'; secret: string }

const ACTIVATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_ACTIVATION_SECRET_LENGTH = 512
const ACTIVATION_PATH = '/activate'

function isLocalHostname(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function normalizeActivationPath(pathname: string): string {
	const path = pathname.replace(/\/+$/, '') || '/'
	return path === '/' ? ACTIVATION_PATH : path
}

function parseLinkBase(value: string | undefined): URL | null {
	if (!value?.trim()) return null

	try {
		const url = new URL(value.trim())
		const isAllowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHostname(url.hostname))
		if (!isAllowedProtocol || url.username || url.password || url.search || url.hash) return null
		if (normalizeActivationPath(url.pathname) !== ACTIVATION_PATH) return null
		url.pathname = ACTIVATION_PATH
		return url
	} catch {
		return null
	}
}

function parseCustomPayload(url: URL): ActivationPayload | null {
	if (url.protocol !== 'vizaje:' || url.hostname !== 'activate' || url.username || url.password || url.port || url.hash) return null
	if (url.pathname !== '' && url.pathname !== '/') return null

	const keys = Array.from(url.searchParams.keys())
	if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes('activationId') || !keys.includes('secret')) return null

	const activationId = url.searchParams.get('activationId')
	const secret = url.searchParams.get('secret')
	if (!activationId || !secret || !ACTIVATION_ID_PATTERN.test(activationId) || secret.length > MAX_ACTIVATION_SECRET_LENGTH) return null
	return { source: 'custom', activationId, secret }
}

/**
 * Parses either the legacy custom-scheme payload or a configured HTTPS link.
 * The secret is returned only in memory for immediate redemption; callers must
 * not log or persist it.
 */
export function parseActivationPayload(value: string, linkBaseUrl?: string): ActivationPayload | null {
	if (typeof value !== 'string' || value.trim().length === 0) return null

	try {
		const url = new URL(value.trim())
		const custom = parseCustomPayload(url)
		if (custom) return custom

		if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostname(url.hostname))) return null
		if (url.username || url.password || url.hash || url.port && url.protocol === 'https:') return null

		const base = parseLinkBase(linkBaseUrl)
		if (!base || url.origin !== base.origin || normalizeActivationPath(url.pathname) !== ACTIVATION_PATH) return null

		const keys = Array.from(url.searchParams.keys())
		if (keys.length !== 1 || keys[0] !== 'token') return null
		const secret = url.searchParams.get('token')
		if (!secret || secret.length > MAX_ACTIVATION_SECRET_LENGTH) return null
		return { source: 'link', secret }
	} catch {
		return null
	}
}

/** Builds a link from the same custom-scheme payload that is rendered as QR. */
export function buildActivationLink(payload: string, linkBaseUrl?: string): string | null {
	try {
		const parsed = parseCustomPayload(new URL(payload.trim()))
		const base = parseLinkBase(linkBaseUrl)
		if (!parsed || !base) return null

		const link = new URL(base.toString())
		link.pathname = ACTIVATION_PATH
		link.search = ''
		link.hash = ''
		link.searchParams.set('token', parsed.secret)
		return link.toString()
	} catch {
		return null
	}
}

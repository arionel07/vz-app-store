export type ActivationPayload = {
	activationId: string
	secret: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Parse only the activation URL emitted by the API. The secret is never logged or persisted here. */
export function parseActivationPayload(value: string): ActivationPayload | null {
	if (typeof value !== 'string' || value.trim().length === 0) return null

	try {
		const url = new URL(value.trim())
		if (url.protocol !== 'vizaje:' || url.hostname !== 'activate' || url.username || url.password || url.port || url.hash) {
			return null
		}
		if (url.pathname !== '' && url.pathname !== '/') return null
		const keys = Array.from(url.searchParams.keys())
		if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes('activationId') || !keys.includes('secret')) return null

		const activationId = url.searchParams.get('activationId')
		const secret = url.searchParams.get('secret')
		if (!activationId || !secret || !UUID_PATTERN.test(activationId) || secret.length > 512) return null
		return { activationId, secret }
	} catch {
		return null
	}
}

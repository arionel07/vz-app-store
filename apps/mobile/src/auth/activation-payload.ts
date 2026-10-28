import type { ActivationPayload } from '@vizaje/contracts'
export { parseActivationPayload } from '@vizaje/contracts'
export type { ActivationPayload } from '@vizaje/contracts'

/** Keeps repeated OS link events from presenting or redeeming the same secret twice. */
export function createActivationLinkGate() {
	const seenSecrets = new Set<string>()
	return (payload: ActivationPayload): boolean => {
		if (seenSecrets.has(payload.secret)) return false
		seenSecrets.add(payload.secret)
		return true
	}
}

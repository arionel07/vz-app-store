import { isActivationUrlCandidate } from './activation-payload'
import { parseActivationPayload, type ActivationPayload } from './activation-payload'

export type ActivationUrlResolution =
	| { kind: 'unrelated' }
	| { kind: 'malformed' }
	| { kind: 'activation'; payload: ActivationPayload }

/** Classifies a URL without retaining or logging activation secrets. */
export function resolveActivationUrl(value: string, linkBaseUrl?: string): ActivationUrlResolution {
	if (!isActivationUrlCandidate(value, linkBaseUrl)) return { kind: 'unrelated' }
	const payload = parseActivationPayload(value, linkBaseUrl)
	return payload ? { kind: 'activation', payload } : { kind: 'malformed' }
}

import { describe, expect, test } from 'bun:test'
import { parseActivationPayload } from '../src/auth/activation-payload'

const activationId = '11111111-1111-4111-8111-111111111111'

describe('activation QR payload', () => {
	test('accepts the exact API deep link and decodes the secret', () => {
		expect(parseActivationPayload(`vizaje://activate?activationId=${activationId}&secret=${encodeURIComponent('secret/+=')}`)).toEqual({
			activationId,
			secret: 'secret/+=',
		})
	})

	test('rejects malformed, unrelated and ambiguous payloads', () => {
		expect(parseActivationPayload('https://activate.example/?secret=secret')).toBeNull()
		expect(parseActivationPayload(`vizaje://wrong?activationId=${activationId}&secret=secret`)).toBeNull()
		expect(parseActivationPayload(`vizaje://activate?activationId=nope&secret=secret`)).toBeNull()
		expect(parseActivationPayload(`vizaje://activate?activationId=${activationId}&secret=secret&secret=again`)).toBeNull()
		expect(parseActivationPayload(`vizaje://activate?activationId=${activationId}`)).toBeNull()
	})

	test('rejects a secret longer than the shared contract limit', () => {
		expect(parseActivationPayload(`vizaje://activate?activationId=${activationId}&secret=${'x'.repeat(513)}`)).toBeNull()
	})
})

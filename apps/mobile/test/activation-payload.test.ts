import { describe, expect, test } from 'bun:test'
import { buildActivationLink, parseActivationPayload } from '@vizaje/contracts'
import { createActivationLinkGate, parseActivationPayload as parseMobileActivationPayload } from '../src/auth/activation-payload'

const activationId = '11111111-1111-4111-8111-111111111111'

describe('activation QR payload', () => {
	test('accepts the exact API deep link and decodes the secret', () => {
		expect(parseMobileActivationPayload(`vizaje://activate?activationId=${activationId}&secret=${encodeURIComponent('secret/+=')}`)).toEqual({
			source: 'custom',
			activationId,
			secret: 'secret/+=',
		})
	})

	test('rejects malformed, unrelated and ambiguous payloads', () => {
		expect(parseMobileActivationPayload('https://activate.example/?secret=secret', 'https://staff.example.com/activate')).toBeNull()
		expect(parseMobileActivationPayload(`vizaje://wrong?activationId=${activationId}&secret=secret`)).toBeNull()
		expect(parseMobileActivationPayload(`vizaje://activate?activationId=nope&secret=secret`)).toBeNull()
		expect(parseMobileActivationPayload(`vizaje://activate?activationId=${activationId}&secret=secret&secret=again`)).toBeNull()
		expect(parseMobileActivationPayload(`vizaje://activate?activationId=${activationId}`)).toBeNull()
	})

	test('rejects a secret longer than the shared contract limit', () => {
		expect(parseMobileActivationPayload(`vizaje://activate?activationId=${activationId}&secret=${'x'.repeat(513)}`)).toBeNull()
	})

	test('builds and parses an HTTPS link with the same one-time secret', () => {
		const qrPayload = `vizaje://activate?activationId=${activationId}&secret=${encodeURIComponent('same-secret/+=')}`
		const link = buildActivationLink(qrPayload, 'https://staff.example.com/activate')
		expect(link).toBe('https://staff.example.com/activate?token=same-secret%2F%2B%3D')
		expect(parseActivationPayload(link!, 'https://staff.example.com/activate')).toEqual({ source: 'link', secret: 'same-secret/+=' })
	})

	test('accepts local HTTP only for configured development fallback', () => {
		expect(parseActivationPayload('http://localhost:3001/activate?token=local-secret', 'http://localhost:3001/activate')).toEqual({ source: 'link', secret: 'local-secret' })
		expect(parseActivationPayload('http://attacker.example/activate?token=local-secret', 'http://localhost:3001/activate')).toBeNull()
		expect(parseActivationPayload('https://staff.example.com/activate?token=secret&extra=value', 'https://staff.example.com/activate')).toBeNull()
	})

	test('suppresses duplicate link events without persisting the secret', () => {
		const gate = createActivationLinkGate()
		const payload = { source: 'link' as const, secret: 'one-time-secret' }
		expect(gate(payload)).toBe(true)
		expect(gate(payload)).toBe(false)
		expect(gate({ source: 'custom', activationId, secret: payload.secret })).toBe(false)
		expect(gate({ source: 'link', secret: 'another-secret' })).toBe(true)
	})
})

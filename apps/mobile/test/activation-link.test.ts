import { describe, expect, test } from 'bun:test'
import { resolveActivationUrl } from '../src/auth/activation-link'
import { activationError } from '../src/auth/activation-errors'
import { ApiError } from '../src/api/client'

const id = '11111111-1111-4111-8111-111111111111'

describe('activation URL handling', () => {
	test('accepts generated custom-scheme QR payloads', () => {
		expect(resolveActivationUrl(`vizaje://activate?activationId=${id}&secret=secret`)).toEqual({
			kind: 'activation',
			payload: { source: 'custom', activationId: id, secret: 'secret' },
		})
	})

	test('accepts only links matching the configured HTTPS origin and route', () => {
		expect(resolveActivationUrl('https://staff.example.com/activate?token=secret', 'https://staff.example.com/activate')).toEqual({
			kind: 'activation',
			payload: { source: 'link', secret: 'secret' },
		})
		expect(resolveActivationUrl('https://other.example.com/activate?token=secret', 'https://staff.example.com/activate')).toEqual({ kind: 'unrelated' })
	})

	test('separates malformed activation-intent links from unrelated links without including secrets', () => {
		expect(resolveActivationUrl(`vizaje://activate?activationId=${id}&secret=`)).toEqual({ kind: 'malformed' })
		expect(resolveActivationUrl('https://staff.example.com/activate?token=', 'https://staff.example.com/activate')).toEqual({ kind: 'malformed' })
		expect(resolveActivationUrl('https://staff.example.com/home', 'https://staff.example.com/activate')).toEqual({ kind: 'unrelated' })
	})
})

describe('activation failure messaging', () => {
	test('keeps expired, used and unknown bearer tokens indistinguishable', () => {
		expect(activationError(new ApiError(401, 'INVALID_ACTIVATION', 'invalid'))).toBe('Код недействителен, уже использован или срок его действия истёк.')
	})

	test('shows separate rate-limit, network and service errors', () => {
		expect(activationError(new ApiError(429, 'RATE_LIMITED', 'limited'))).toContain('Слишком много попыток')
		expect(activationError(new ApiError(0, 'NETWORK_UNAVAILABLE', 'offline'))).toContain('Проверьте подключение')
		expect(activationError(new ApiError(503, 'UNAVAILABLE', 'offline'))).toContain('Не удалось активировать')
	})
})

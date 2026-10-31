import { describe, expect, test } from 'bun:test'
import { dialogFocusWrapTarget } from '../src/components/ui/dialog-focus'

describe('accessible dialog keyboard focus', () => {
	test('wraps forward from the last enabled control to the first', () => {
		expect(dialogFocusWrapTarget(4, 5, false)).toBe('first')
	})

	test('wraps backward from the first enabled control to the last', () => {
		expect(dialogFocusWrapTarget(0, 5, true)).toBe('last')
	})

	test('returns focus from outside into the open dialog and handles an empty dialog', () => {
		expect(dialogFocusWrapTarget(-1, 5, false)).toBe('first')
		expect(dialogFocusWrapTarget(-1, 5, true)).toBe('last')
		expect(dialogFocusWrapTarget(-1, 0, false)).toBe('panel')
	})

	test('does not interrupt ordinary movement between enabled controls', () => {
		expect(dialogFocusWrapTarget(2, 5, false)).toBeNull()
		expect(dialogFocusWrapTarget(2, 5, true)).toBeNull()
	})
})

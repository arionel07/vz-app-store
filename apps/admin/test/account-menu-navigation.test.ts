import { describe, expect, test } from 'bun:test'
import { shouldDismissAccountPopover } from '../src/lib/account-menu-navigation'

describe('account popover keyboard dismissal', () => {
	test('always dismisses on Escape', () => {
		expect(shouldDismissAccountPopover({ key: 'Escape', shiftKey: false, focusIndex: 2, focusableCount: 5 })).toBe(true)
	})

	test('dismisses when Tab moves beyond the first or last control', () => {
		expect(shouldDismissAccountPopover({ key: 'Tab', shiftKey: true, focusIndex: 0, focusableCount: 5 })).toBe(true)
		expect(shouldDismissAccountPopover({ key: 'Tab', shiftKey: false, focusIndex: 4, focusableCount: 5 })).toBe(true)
	})

	test('keeps the disclosure open while moving between controls', () => {
		expect(shouldDismissAccountPopover({ key: 'Tab', shiftKey: false, focusIndex: 2, focusableCount: 5 })).toBe(false)
		expect(shouldDismissAccountPopover({ key: 'ArrowDown', shiftKey: false, focusIndex: 4, focusableCount: 5 })).toBe(false)
		expect(shouldDismissAccountPopover({ key: 'Tab', shiftKey: false, focusIndex: -1, focusableCount: 5 })).toBe(false)
	})
})

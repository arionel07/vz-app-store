import { describe, expect, test } from 'bun:test'
import { scheduleDateInTimeZone, scheduleWeekStart, shiftScheduleDate } from '@vizaje/contracts'

describe('schedule calendar date helpers', () => {
	test('uses store-local date instead of UTC date near midnight', () => {
		expect(scheduleDateInTimeZone(new Date('2026-02-28T22:30:00.000Z'))).toBe('2026-03-01')
	})

	test('starts weeks on Monday and shifts date-only values without timezone drift', () => {
		expect(scheduleWeekStart('2026-03-01')).toBe('2026-02-23')
		expect(scheduleDateInTimeZone(new Date('2026-03-02T00:15:00.000Z'))).toBe('2026-03-02')
		expect(shiftScheduleDate('2026-03-01', -1)).toBe('2026-02-28')
	})
})

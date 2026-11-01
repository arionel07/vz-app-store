export const DEFAULT_SCHEDULE_TIME_ZONE = 'Europe/Chisinau'

export function scheduleDateInTimeZone(
	instant: Date = new Date(),
	timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(instant)
	const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
	return `${value.year}-${value.month}-${value.day}`
}

export function shiftScheduleDate(value: string, amount: number): string {
	const date = new Date(`${value}T00:00:00.000Z`)
	if (Number.isNaN(date.getTime())) throw new RangeError('Invalid schedule date')
	date.setUTCDate(date.getUTCDate() + amount)
	return date.toISOString().slice(0, 10)
}

/** Returns the Monday starting the week containing this ISO calendar date. */
export function scheduleWeekStart(value: string): string {
	const date = new Date(`${value}T00:00:00.000Z`)
	if (Number.isNaN(date.getTime())) throw new RangeError('Invalid schedule date')
	const mondayOffset = (date.getUTCDay() + 6) % 7
	date.setUTCDate(date.getUTCDate() - mondayOffset)
	return date.toISOString().slice(0, 10)
}

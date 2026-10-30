import { describe, expect, test } from 'bun:test'
import { canEditTask, canSubmitTask, taskProgress } from '../src/tasks/model'

describe('task model', () => {
	test('calculates checklist progress without inventing completion', () => {
		expect(taskProgress({ checklist: [{ completed: true }, { completed: false }] } as never)).toEqual({ completed: 1, total: 2 })
	})

	test('allows edits and submit only while working or correcting a rejection', () => {
		expect(canEditTask('assigned')).toBe(false)
		expect(canEditTask('in_progress')).toBe(true)
		expect(canEditTask('rejected')).toBe(true)
		expect(canSubmitTask('submitted')).toBe(false)
		expect(canSubmitTask('in_progress')).toBe(true)
	})
})

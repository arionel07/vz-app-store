import { describe, expect, test } from 'bun:test'
import type { StoreResponse } from '@vizaje/contracts'
import { authorizedOperationStore, canResubmitOperation, dateRangeLabel, operationErrorMessage, operationProgress } from '../src/operations/model'

const store = (id: string, isActive = true): StoreResponse => ({ id, name: `Магазин ${id}`, code: 'MSK', isActive, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })

describe('retail operations mobile model', () => {
	test('binds a workflow only to an active authenticated assignment', () => {
		const active = store('11111111-1111-4111-8111-111111111111')
		const inactive = store('22222222-2222-4222-8222-222222222222', false)
		expect(authorizedOperationStore([active], null)).toEqual(active)
		expect(authorizedOperationStore([active, inactive], active.id)).toEqual(active)
		expect(authorizedOperationStore([active], inactive.id)).toBeNull()
		expect(authorizedOperationStore([inactive], null)).toBeNull()
		expect(authorizedOperationStore([active, store('33333333-3333-4333-8333-333333333333')], null)).toBeNull()
	})

	test('allows corrections only for rejected submissions and maps progress', () => {
		expect(canResubmitOperation('rejected')).toBe(true)
		expect(canResubmitOperation('submitted')).toBe(false)
		expect(operationProgress('checked')).toBe(100)
		expect(operationProgress('submitted')).toBe(65)
		expect(operationProgress('rejected')).toBe(35)
		expect(operationProgress('not_started')).toBe(0)
	})

	test('shows safe Russian messages for API failure classes', () => {
		expect(operationErrorMessage({ status: 0 })).toContain('Нет соединения')
		expect(operationErrorMessage({ status: 401 })).toContain('Сессия закончилась')
		expect(operationErrorMessage({ status: 403 })).toContain('нет доступа')
		expect(operationErrorMessage({ status: 404 })).toContain('недоступна')
		expect(operationErrorMessage({ status: 409 })).toContain('изменились')
	})

	test('formats campaign dates for Russian staff UI', () => {
		expect(dateRangeLabel('2026-06-02T00:00:00.000Z', '2026-06-08T00:00:00.000Z')).toMatch(/июн/)
	})
})

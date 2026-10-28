import { describe, expect, test } from 'bun:test'
import { availableStoreSelection, isAuthorizedStore } from '../src/photos/store-selection'
import type { StoreResponse } from '@vizaje/contracts'

const store = (id: string, isActive = true): StoreResponse => ({ id, name: `Магазин ${id}`, code: id.slice(0, 4), isActive, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })

describe('photo store selection', () => {
	test('auto-selects the only active assigned store', () => {
		expect(availableStoreSelection([store('11111111-1111-4111-8111-111111111111')], null)).toEqual({ selectedStoreId: '11111111-1111-4111-8111-111111111111', needsSelection: false, available: true })
	})

	test('requires explicit selection for multiple stores and rejects arbitrary IDs', () => {
		const stores = [store('11111111-1111-4111-8111-111111111111'), store('22222222-2222-4222-8222-222222222222')]
		expect(availableStoreSelection(stores, null).needsSelection).toBe(true)
		expect(isAuthorizedStore(stores, '33333333-3333-4333-8333-333333333333')).toBe(false)
		expect(isAuthorizedStore(stores, stores[1].id)).toBe(true)
	})

	test('has no upload target when all assigned stores are inactive', () => {
		expect(availableStoreSelection([store('11111111-1111-4111-8111-111111111111', false)], null)).toEqual({ selectedStoreId: null, needsSelection: false, available: false })
	})
})

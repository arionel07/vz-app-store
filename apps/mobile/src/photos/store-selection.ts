import type { StoreResponse } from '@vizaje/contracts'

export function availableStoreSelection(stores: StoreResponse[], selectedStoreId: string | null): {
	selectedStoreId: string | null
	needsSelection: boolean
	available: boolean
} {
	const active = stores.filter((store) => store.isActive)
	if (active.length === 0) return { selectedStoreId: null, needsSelection: false, available: false }
	if (active.length === 1) return { selectedStoreId: active[0].id, needsSelection: false, available: true }
	const selected = selectedStoreId && active.some((store) => store.id === selectedStoreId) ? selectedStoreId : null
	return { selectedStoreId: selected, needsSelection: selected === null, available: true }
}

export function isAuthorizedStore(stores: StoreResponse[], storeId: string | null): storeId is string {
	return Boolean(storeId && stores.some((store) => store.id === storeId && store.isActive))
}

import type { StoreResponse } from '@vizaje/contracts'
import { useEffect, useMemo } from 'react'
import { useAuth } from '../auth/auth-context'
import { authorizedOperationStore } from './model'
import { clearPrivateMediaCache, didStoreContextChange } from '../photos/private-media-cache'

let previousOperationStoreId: string | null | undefined

export function useSelectedOperationStore(requestedId?: string): { store: StoreResponse | null; stores: StoreResponse[] } {
	const { user } = useAuth()
	const stores = useMemo(() => user?.assignedStores.filter((store) => store.isActive) ?? [], [user?.assignedStores])
	const store = useMemo(() => authorizedOperationStore(stores, requestedId ?? null), [requestedId, stores])
	useEffect(() => {
		const nextStoreId = store?.id ?? null
		if (didStoreContextChange(previousOperationStoreId, nextStoreId)) void clearPrivateMediaCache()
		previousOperationStoreId = nextStoreId
	}, [store?.id])
	return { store, stores }
}

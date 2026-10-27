'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { UserResponse } from '@vizaje/contracts'

const SessionUserContext = createContext<UserResponse | null>(null)

export function SessionProvider({ user, children }: { user: UserResponse; children: ReactNode }) {
	return <SessionUserContext.Provider value={user}>{children}</SessionUserContext.Provider>
}

export function useSessionUser(): UserResponse {
	const user = useContext(SessionUserContext)
	if (!user) throw new Error('useSessionUser must be used inside SessionProvider')
	return user
}

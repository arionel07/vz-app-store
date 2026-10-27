import type { ReactNode } from 'react'
import { SessionProvider } from '@/components/session-provider'
import { requireAdminUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
	const user = await requireAdminUser()
	return <SessionProvider user={user}>{children}</SessionProvider>
}

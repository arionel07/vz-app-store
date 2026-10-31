import { merchandisingListResponseSchema, merchandisingQuerySchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
export async function GET(request: Request): Promise<NextResponse> {
	const incoming = new URL(request.url)
	const parsed = parseWithSchema(merchandisingQuerySchema, Object.fromEntries(incoming.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = new URLSearchParams({ page: String(parsed.page), pageSize: String(parsed.pageSize), includeInactive: 'true' })
	if (parsed.storeId) query.set('storeId', parsed.storeId)
	if (parsed.status) query.set('status', parsed.status)
	if (parsed.active !== undefined) query.set('active', String(parsed.active))
	return proxyManagement(request, `/api/v1/management/operations/merchandising?${query}`, merchandisingListResponseSchema)
}

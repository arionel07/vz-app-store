import { requestListResponseSchema, requestQuerySchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
export async function GET(request: Request): Promise<NextResponse> {
	const incoming = new URL(request.url)
	const parsed = parseWithSchema(requestQuerySchema, Object.fromEntries(incoming.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = new URLSearchParams({ page: String(parsed.page), pageSize: String(parsed.pageSize) })
	for (const [key, value] of Object.entries(parsed)) if (key !== 'page' && key !== 'pageSize' && value !== undefined) query.set(key, String(value))
	return proxyManagement(request, `/api/v1/operations/requests?${query}`, requestListResponseSchema)
}

import { campaignCreateSchema, campaignListResponseSchema, campaignQuerySchema, campaignResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const incoming = new URL(request.url)
	const parsed = parseWithSchema(campaignQuerySchema, Object.fromEntries(incoming.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = new URLSearchParams({ page: String(parsed.page), pageSize: String(parsed.pageSize) })
	if (parsed.status) query.set('status', parsed.status)
	if (parsed.storeId) query.set('storeId', parsed.storeId)
	return proxyManagement(request, `/api/v1/management/operations/campaigns?${query}`, campaignListResponseSchema)
}

export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(campaignCreateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/management/operations/campaigns', campaignResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

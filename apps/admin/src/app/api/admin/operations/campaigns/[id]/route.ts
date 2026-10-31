import { campaignResponseSchema, campaignUpdateSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Кампания')
	if (isNextResponse(id)) return id
	return proxyManagement(request, `/api/v1/operations/campaigns/${id}`, campaignResponseSchema)
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Кампания')
	if (isNextResponse(id)) return id
	const parsed = parseWithSchema(campaignUpdateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/operations/campaigns/${id}`, campaignResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed) })
}

import { campaignReviewResponseSchema, campaignReviewSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Отчёт кампании')
	if (isNextResponse(id)) return id
	const parsed = parseWithSchema(campaignReviewSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/operations/campaign-executions/${id}/review`, campaignReviewResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

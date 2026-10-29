import { photoReportDetailResponseSchema, photoReviewApproveSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Отчёт')
	if (isNextResponse(id)) return id
	const body = parseWithSchema(photoReviewApproveSchema, await readJsonBody(request))
	if (isNextResponse(body)) return body
	return proxyManagement(request, `/api/v1/photo-reports/${id}/check`, photoReportDetailResponseSchema, { method: 'POST', body: JSON.stringify(body) })
}

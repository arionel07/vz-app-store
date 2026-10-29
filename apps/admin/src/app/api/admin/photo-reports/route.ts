import { photoReportListResponseSchema, photoReviewCollectionQuerySchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, queryFromSearchParams } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const url = new URL(request.url)
	const parsed = parseWithSchema(photoReviewCollectionQuerySchema, Object.fromEntries(url.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = queryFromSearchParams(new URLSearchParams(), {
		page: parsed.page,
		pageSize: parsed.pageSize,
		storeId: parsed.storeId,
		uploadedBy: parsed.uploadedBy,
		status: parsed.status,
		startDate: parsed.startDate,
		endDate: parsed.endDate,
	})
	return proxyManagement(request, `/api/v1/photo-reports?${query}`, photoReportListResponseSchema)
}

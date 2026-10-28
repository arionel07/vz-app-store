import { photoCollectionQuerySchema, photoListResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, queryFromSearchParams } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const url = new URL(request.url)
	const parsed = parseWithSchema(photoCollectionQuerySchema, Object.fromEntries(url.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = queryFromSearchParams(new URLSearchParams(), {
		page: parsed.page,
		pageSize: parsed.pageSize,
		storeId: parsed.storeId,
		uploadedBy: parsed.uploadedBy,
		startDate: parsed.startDate,
		endDate: parsed.endDate,
	})
	return proxyManagement(request, `/api/v1/photos?${query}`, photoListResponseSchema)
}

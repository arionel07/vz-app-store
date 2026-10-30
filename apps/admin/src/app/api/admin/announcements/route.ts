import { announcementCreateSchema, announcementListQuerySchema, announcementListResponseSchema, announcementResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, queryFromSearchParams, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const url = new URL(request.url)
	const parsed = parseWithSchema(announcementListQuerySchema, Object.fromEntries(url.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = queryFromSearchParams(new URLSearchParams(), { page: parsed.page, pageSize: parsed.pageSize, status: parsed.status })
	return proxyManagement(request, `/api/v1/management/announcements?${query}`, announcementListResponseSchema)
}

export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(announcementCreateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/management/announcements', announcementResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

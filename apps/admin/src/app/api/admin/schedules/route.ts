import { scheduleListQuerySchema, scheduleListResponseSchema, schedulePeriodCreateSchema, schedulePeriodResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, queryFromSearchParams, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const url = new URL(request.url)
	const parsed = parseWithSchema(scheduleListQuerySchema, Object.fromEntries(url.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = queryFromSearchParams(new URLSearchParams(), { page: parsed.page, pageSize: parsed.pageSize, storeId: parsed.storeId, status: parsed.status, from: parsed.from, to: parsed.to })
	return proxyManagement(request, `/api/v1/management/schedules?${query}`, scheduleListResponseSchema)
}

export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(schedulePeriodCreateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/management/schedules', schedulePeriodResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

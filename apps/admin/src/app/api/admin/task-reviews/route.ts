import { taskListQuerySchema, taskReviewListResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(taskListQuerySchema, Object.fromEntries(new URL(request.url).searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = new URLSearchParams({ page: String(parsed.page), pageSize: String(parsed.pageSize) })
	if (parsed.storeId) query.set('storeId', parsed.storeId)
	if (parsed.priority) query.set('priority', parsed.priority)
	return proxyManagement(request, `/api/v1/management/task-reviews?${query}`, taskReviewListResponseSchema)
}

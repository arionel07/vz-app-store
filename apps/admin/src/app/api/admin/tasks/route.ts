import { taskCreateSchema, taskListQuerySchema, taskListResponseSchema, taskResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

function queryString(value: { page: number; pageSize: number; storeId?: string; assignedEmployeeId?: string; status?: string; priority?: string; overdue?: boolean }): string {
	const query = new URLSearchParams({ page: String(value.page), pageSize: String(value.pageSize) })
	for (const [key, item] of Object.entries(value)) if (key !== 'page' && key !== 'pageSize' && item !== undefined) query.set(key, String(item))
	return query.toString()
}

export async function GET(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(taskListQuerySchema, Object.fromEntries(new URL(request.url).searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/tasks?${queryString(parsed)}`, taskListResponseSchema)
}

export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(taskCreateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/management/tasks', taskResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

import { taskTemplateCreateSchema, taskTemplateListQuerySchema, taskTemplateListResponseSchema, taskTemplateResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(taskTemplateListQuerySchema, Object.fromEntries(new URL(request.url).searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = new URLSearchParams({ page: String(parsed.page), pageSize: String(parsed.pageSize) })
	if (parsed.active !== undefined) query.set('active', String(parsed.active))
	return proxyManagement(request, `/api/v1/management/task-templates?${query}`, taskTemplateListResponseSchema)
}

export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(taskTemplateCreateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/management/task-templates', taskTemplateResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

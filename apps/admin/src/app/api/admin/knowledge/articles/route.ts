import { knowledgeAdminArticleResponseSchema, knowledgeAdminListQuerySchema, knowledgeAdminListResponseSchema, knowledgeArticleCreateSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, queryFromSearchParams, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const url = new URL(request.url)
	const parsed = parseWithSchema(knowledgeAdminListQuerySchema, Object.fromEntries(url.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = queryFromSearchParams(new URLSearchParams(), { page: parsed.page, pageSize: parsed.pageSize, search: parsed.search, categoryId: parsed.categoryId, status: parsed.status })
	return proxyManagement(request, `/api/v1/management/knowledge/articles?${query}`, knowledgeAdminListResponseSchema)
}

export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(knowledgeArticleCreateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/management/knowledge/articles', knowledgeAdminArticleResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

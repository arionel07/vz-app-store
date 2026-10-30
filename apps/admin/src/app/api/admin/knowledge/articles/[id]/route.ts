import { knowledgeAdminArticleResponseSchema, knowledgeArticleUpdateSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

async function articleId(context: RouteContext): Promise<string | NextResponse> {
	const id = parseUuid((await context.params).id, 'Материал')
	return id
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = await articleId(context)
	if (isNextResponse(id)) return id
	return proxyManagement(request, `/api/v1/management/knowledge/articles/${id}`, knowledgeAdminArticleResponseSchema)
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = await articleId(context)
	if (isNextResponse(id)) return id
	const parsed = parseWithSchema(knowledgeArticleUpdateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/knowledge/articles/${id}`, knowledgeAdminArticleResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed) })
}

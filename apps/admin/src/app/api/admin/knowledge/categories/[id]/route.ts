import { knowledgeCategoryResponseSchema, knowledgeCategoryUpdateSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Категория')
	if (isNextResponse(id)) return id
	const parsed = parseWithSchema(knowledgeCategoryUpdateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/knowledge/categories/${id}`, knowledgeCategoryResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed) })
}

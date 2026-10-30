import { knowledgeCategoryCreateSchema, knowledgeCategoryListResponseSchema, knowledgeCategoryResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	return proxyManagement(request, '/api/v1/management/knowledge/categories', knowledgeCategoryListResponseSchema)
}

export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(knowledgeCategoryCreateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/management/knowledge/categories', knowledgeCategoryResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

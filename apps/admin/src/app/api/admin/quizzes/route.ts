import {
	quizCreateInputSchema,
	quizAuthoringResponseSchema,
	quizListQuerySchema,
	quizListResponseSchema,
} from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, queryFromSearchParams, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const url = new URL(request.url)
	const parsed = parseWithSchema(quizListQuerySchema, Object.fromEntries(url.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = queryFromSearchParams(new URLSearchParams(), {
		page: parsed.page,
		pageSize: parsed.pageSize,
		status: parsed.status,
		search: parsed.search,
	})
	return proxyManagement(request, `/api/v1/management/quizzes?${query}`, quizListResponseSchema)
}

export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(quizCreateInputSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/management/quizzes', quizAuthoringResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

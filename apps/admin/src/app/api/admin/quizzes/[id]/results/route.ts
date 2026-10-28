import { attemptListQuerySchema, resultListResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, queryFromSearchParams } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Квиз')
	if (isNextResponse(id)) return id
	const url = new URL(request.url)
	const parsed = parseWithSchema(attemptListQuerySchema, { ...Object.fromEntries(url.searchParams.entries()), quizId: id })
	if (isNextResponse(parsed)) return parsed
	const query = queryFromSearchParams(new URLSearchParams(), {
		page: parsed.page,
		pageSize: parsed.pageSize,
		userId: parsed.userId,
		status: parsed.status,
	})
	return proxyManagement(request, `/api/v1/management/quizzes/${id}/results?${query}`, resultListResponseSchema)
}

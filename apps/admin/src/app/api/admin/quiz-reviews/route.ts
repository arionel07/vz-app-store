import { quizReviewListQuerySchema, quizReviewListResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, queryFromSearchParams } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const url = new URL(request.url)
	const parsed = parseWithSchema(quizReviewListQuerySchema, Object.fromEntries(url.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed
	const query = queryFromSearchParams(new URLSearchParams(), {
		page: parsed.page,
		pageSize: parsed.pageSize,
		status: parsed.status,
		quizId: parsed.quizId,
		userId: parsed.userId,
	})
	return proxyManagement(request, `/api/v1/management/quiz-reviews?${query}`, quizReviewListResponseSchema)
}

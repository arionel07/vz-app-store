import { quizReviewInputSchema, quizReviewResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ attemptId: string; questionId: string }> }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	const params = await context.params
	const attemptId = parseUuid(params.attemptId, 'Попытка')
	const questionId = parseUuid(params.questionId, 'Вопрос')
	if (isNextResponse(attemptId)) return attemptId
	if (isNextResponse(questionId)) return questionId
	const parsed = parseWithSchema(quizReviewInputSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/quiz-attempts/${attemptId}/questions/${questionId}/review`, quizReviewResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

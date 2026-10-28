import { quizAuthoringResponseSchema, quizDraftInputSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Квиз')
	if (isNextResponse(id)) return id
	const parsed = parseWithSchema(quizDraftInputSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/quizzes/${id}/draft`, quizAuthoringResponseSchema, { method: 'PUT', body: JSON.stringify(parsed) })
}

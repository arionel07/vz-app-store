import { quizArchiveResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, proxyManagement } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Квиз')
	if (isNextResponse(id)) return id
	return proxyManagement(request, `/api/v1/management/quizzes/${id}/archive`, quizArchiveResponseSchema, { method: 'POST' })
}

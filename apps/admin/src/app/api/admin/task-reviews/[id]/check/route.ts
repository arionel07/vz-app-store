import { taskResponseSchema, taskReviewSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Отправка задания')
	if (isNextResponse(id)) return id
	const parsed = parseWithSchema(taskReviewSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/task-submissions/${id}/check`, taskResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

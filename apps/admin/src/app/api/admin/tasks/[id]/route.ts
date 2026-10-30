import { taskResponseSchema, taskUpdateSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Задание')
	if (isNextResponse(id)) return id
	return proxyManagement(request, `/api/v1/management/tasks/${id}`, taskResponseSchema)
}

export async function PATCH(request: Request, context: Context): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Задание')
	if (isNextResponse(id)) return id
	const parsed = parseWithSchema(taskUpdateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/tasks/${id}`, taskResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed) })
}

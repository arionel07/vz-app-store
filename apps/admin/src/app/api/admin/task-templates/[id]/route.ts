import { taskTemplateResponseSchema, taskTemplateUpdateSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Шаблон задания')
	if (isNextResponse(id)) return id
	const parsed = parseWithSchema(taskTemplateUpdateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, `/api/v1/management/task-templates/${id}`, taskTemplateResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed) })
}

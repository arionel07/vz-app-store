import { knowledgeAttachmentResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { fetchManagementApi, forwardBffResponse, getManagementRequestOptions } from '@/lib/auth'
import { isNextResponse, parseUuid } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Материал')
	if (isNextResponse(id)) return id
	try {
		const form = await request.formData()
		const upstream = await fetchManagementApi(`/api/v1/management/knowledge/articles/${id}/attachments`, getManagementRequestOptions(request, { method: 'POST', body: form }))
		return forwardBffResponse(upstream, knowledgeAttachmentResponseSchema, { fallbackErrorCode: 'MANAGEMENT_REQUEST_FAILED', fallbackErrorMessage: 'Загрузка файла не выполнена' })
	} catch {
		return NextResponse.json({ error: { code: 'MANAGEMENT_BACKEND_UNAVAILABLE', message: 'Сервис управления временно недоступен' } }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
	}
}

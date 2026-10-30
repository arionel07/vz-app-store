import { NextResponse } from 'next/server'
import { fetchManagementApi, forwardBffBinaryResponse, getManagementRequestOptions } from '@/lib/auth'
import { isNextResponse, parseUuid, proxyManagementNoContent } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string; attachmentId: string }> }

async function ids(context: RouteContext): Promise<{ id: string; attachmentId: string } | NextResponse> {
	const params = await context.params
	const id = parseUuid(params.id, 'Материал')
	if (isNextResponse(id)) return id
	const attachmentId = parseUuid(params.attachmentId, 'Файл')
	if (isNextResponse(attachmentId)) return attachmentId
	return { id, attachmentId }
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
	const value = await ids(context)
	if (value instanceof NextResponse) return value
	try {
		const upstream = await fetchManagementApi(`/api/v1/management/knowledge/articles/${value.id}/attachments/${value.attachmentId}`, getManagementRequestOptions(request, { method: 'GET' }))
		return forwardBffBinaryResponse(upstream, { fallbackErrorCode: 'KNOWLEDGE_ATTACHMENT_REQUEST_FAILED', fallbackErrorMessage: 'Не удалось получить вложение' })
	} catch {
		return NextResponse.json({ error: { code: 'MANAGEMENT_BACKEND_UNAVAILABLE', message: 'Сервис управления временно недоступен' } }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
	}
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
	const value = await ids(context)
	if (value instanceof NextResponse) return value
	return proxyManagementNoContent(request, `/api/v1/management/knowledge/articles/${value.id}/attachments/${value.attachmentId}`, { method: 'DELETE' })
}

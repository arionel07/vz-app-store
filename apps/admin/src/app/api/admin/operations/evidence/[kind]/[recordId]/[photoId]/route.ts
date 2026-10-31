import { NextResponse } from 'next/server'
import { fetchManagementApi, forwardBffBinaryResponse, getManagementRequestOptions } from '@/lib/auth'
import { isNextResponse, parseUuid } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
const kinds = ['campaign_execution', 'campaign_submission', 'merchandising_inspection', 'store_issue', 'operational_request', 'campaign_reference'] as const
type RouteContext = { params: Promise<{ kind: string; recordId: string; photoId: string }> }
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
	const { kind, recordId: rawRecordId, photoId: rawPhotoId } = await context.params
	if (!kinds.includes(kind as typeof kinds[number])) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Тип файла не поддерживается' } }, { status: 400, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
	const recordId = parseUuid(rawRecordId, 'Запись')
	if (isNextResponse(recordId)) return recordId
	const photoId = parseUuid(rawPhotoId, 'Фото')
	if (isNextResponse(photoId)) return photoId
	try {
		const upstream = await fetchManagementApi(`/api/v1/operations/evidence/${kind}/${recordId}/${photoId}`, getManagementRequestOptions(request, { method: 'GET' }))
		return forwardBffBinaryResponse(upstream, { fallbackErrorCode: 'EVIDENCE_REQUEST_FAILED', fallbackErrorMessage: 'Не удалось получить закрытый файл' })
	} catch {
		return NextResponse.json({ error: { code: 'MANAGEMENT_BACKEND_UNAVAILABLE', message: 'Сервис управления временно недоступен' } }, { status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie' } })
	}
}

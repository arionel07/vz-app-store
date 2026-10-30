import { NextResponse } from 'next/server'
import { fetchManagementApi, forwardBffBinaryResponse, getManagementRequestOptions } from '@/lib/auth'
import { isNextResponse, parseUuid } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Фото задания')
	if (isNextResponse(id)) return id
	try {
		const upstream = await fetchManagementApi(`/api/v1/task-evidence/${id}`, getManagementRequestOptions(request, { method: 'GET' }))
		return forwardBffBinaryResponse(upstream)
	} catch {
		return NextResponse.json({ error: { code: 'MANAGEMENT_BACKEND_UNAVAILABLE', message: 'Сервис управления временно недоступен' } }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
	}
}

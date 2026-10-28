import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, proxyManagementNoContent } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Фотография')
	if (isNextResponse(id)) return id
	return proxyManagementNoContent(request, `/api/v1/photos/${id}`, { method: 'DELETE' })
}

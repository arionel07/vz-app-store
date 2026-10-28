import { userResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, proxyManagement } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; storeId: string }> }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	const params = await context.params
	const id = parseUuid(params.id, 'Сотрудник')
	const storeId = parseUuid(params.storeId, 'Магазин')
	if (isNextResponse(id)) return id
	if (isNextResponse(storeId)) return storeId
	return proxyManagement(request, `/api/v1/users/${id}/stores/${storeId}`, userResponseSchema, { method: 'POST' })
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
	const params = await context.params
	const id = parseUuid(params.id, 'Сотрудник')
	const storeId = parseUuid(params.storeId, 'Магазин')
	if (isNextResponse(id)) return id
	if (isNextResponse(storeId)) return storeId
	return proxyManagement(request, `/api/v1/users/${id}/stores/${storeId}`, userResponseSchema, { method: 'DELETE' })
}

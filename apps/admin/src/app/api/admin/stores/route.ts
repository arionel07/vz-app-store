import {
	createStoreSchema,
	storeListQuerySchema,
	storeListResponseSchema,
	storeResponseSchema,
} from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, queryFromSearchParams, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const url = new URL(request.url)
	const parsed = parseWithSchema(storeListQuerySchema, Object.fromEntries(url.searchParams.entries()))
	if (isNextResponse(parsed)) return parsed

	const query = queryFromSearchParams(new URLSearchParams(), {
		page: parsed.page,
		pageSize: parsed.pageSize,
		search: parsed.search,
		isActive: parsed.isActive,
		sortBy: parsed.sortBy,
		sortDirection: parsed.sortDirection,
	})
	return proxyManagement(request, `/api/v1/stores?${query}`, storeListResponseSchema)
}

export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(createStoreSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/stores', storeResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

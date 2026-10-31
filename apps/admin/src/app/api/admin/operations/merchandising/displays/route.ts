import { merchandisingDisplayCreateSchema, merchandisingDisplayResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
export async function POST(request: Request): Promise<NextResponse> {
	const parsed = parseWithSchema(merchandisingDisplayCreateSchema, await readJsonBody(request))
	if (isNextResponse(parsed)) return parsed
	return proxyManagement(request, '/api/v1/management/operations/merchandising/displays', merchandisingDisplayResponseSchema, { method: 'POST', body: JSON.stringify(parsed) })
}

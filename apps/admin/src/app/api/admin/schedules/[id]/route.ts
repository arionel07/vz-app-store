import { schedulePeriodResponseSchema, schedulePeriodUpdateSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, proxyManagement, readJsonBody, parseWithSchema } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context): Promise<NextResponse> { const id = parseUuid((await context.params).id, 'Расписание'); if (isNextResponse(id)) return id; return proxyManagement(request, `/api/v1/management/schedules/${id}`, schedulePeriodResponseSchema) }
export async function PATCH(request: Request, context: Context): Promise<NextResponse> { const id = parseUuid((await context.params).id, 'Расписание'); if (isNextResponse(id)) return id; const parsed = parseWithSchema(schedulePeriodUpdateSchema, await readJsonBody(request)); if (isNextResponse(parsed)) return parsed; return proxyManagement(request, `/api/v1/management/schedules/${id}`, schedulePeriodResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed) }) }

import { scheduleDayOffCreateSchema, schedulePeriodResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, proxyManagement, readJsonBody, parseWithSchema } from '@/lib/management-bff'
export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> { const id = parseUuid((await context.params).id, 'Расписание'); if (isNextResponse(id)) return id; const parsed = parseWithSchema(scheduleDayOffCreateSchema, await readJsonBody(request)); if (isNextResponse(parsed)) return parsed; return proxyManagement(request, `/api/v1/management/schedules/${id}/days-off`, schedulePeriodResponseSchema, { method: 'POST', body: JSON.stringify(parsed) }) }

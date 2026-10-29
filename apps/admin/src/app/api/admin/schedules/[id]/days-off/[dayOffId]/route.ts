import { scheduleDayOffUpdateSchema, schedulePeriodResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, proxyManagement, readJsonBody, parseWithSchema } from '@/lib/management-bff'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; dayOffId: string }> }
async function ids(context: Context) { const params = await context.params; return { id: parseUuid(params.id, 'Расписание'), dayOffId: parseUuid(params.dayOffId, 'Выходной') } }
export async function PATCH(request: Request, context: Context): Promise<NextResponse> { const { id, dayOffId } = await ids(context); if (isNextResponse(id)) return id; if (isNextResponse(dayOffId)) return dayOffId; const parsed = parseWithSchema(scheduleDayOffUpdateSchema, await readJsonBody(request)); if (isNextResponse(parsed)) return parsed; return proxyManagement(request, `/api/v1/management/schedules/${id}/days-off/${dayOffId}`, schedulePeriodResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed) }) }
export async function DELETE(request: Request, context: Context): Promise<NextResponse> { const { id, dayOffId } = await ids(context); if (isNextResponse(id)) return id; if (isNextResponse(dayOffId)) return dayOffId; return proxyManagement(request, `/api/v1/management/schedules/${id}/days-off/${dayOffId}`, schedulePeriodResponseSchema, { method: 'DELETE' }) }

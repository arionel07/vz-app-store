import { schedulePeriodResponseSchema, scheduleShiftUpdateSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, proxyManagement, readJsonBody, parseWithSchema } from '@/lib/management-bff'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; shiftId: string }> }
async function ids(context: Context) { const params = await context.params; const id = parseUuid(params.id, 'Расписание'); const shiftId = parseUuid(params.shiftId, 'Смена'); return { id, shiftId } }
export async function PATCH(request: Request, context: Context): Promise<NextResponse> { const { id, shiftId } = await ids(context); if (isNextResponse(id)) return id; if (isNextResponse(shiftId)) return shiftId; const parsed = parseWithSchema(scheduleShiftUpdateSchema, await readJsonBody(request)); if (isNextResponse(parsed)) return parsed; return proxyManagement(request, `/api/v1/management/schedules/${id}/shifts/${shiftId}`, schedulePeriodResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed) }) }
export async function DELETE(request: Request, context: Context): Promise<NextResponse> { const { id, shiftId } = await ids(context); if (isNextResponse(id)) return id; if (isNextResponse(shiftId)) return shiftId; return proxyManagement(request, `/api/v1/management/schedules/${id}/shifts/${shiftId}`, schedulePeriodResponseSchema, { method: 'DELETE' }) }

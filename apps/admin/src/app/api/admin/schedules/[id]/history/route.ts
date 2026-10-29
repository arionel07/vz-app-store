import { scheduleHistoryResponseSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import { isNextResponse, parseUuid, proxyManagement } from '@/lib/management-bff'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> { const id = parseUuid((await context.params).id, 'Расписание'); if (isNextResponse(id)) return id; return proxyManagement(request, `/api/v1/management/schedules/${id}/history`, scheduleHistoryResponseSchema) }

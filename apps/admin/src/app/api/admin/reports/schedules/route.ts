import { reportFiltersSchema, reportSchedulesResponseSchema } from '@vizaje/contracts'
import { createReportingGet } from '@/lib/reporting-bff'

export const dynamic = 'force-dynamic'
export const GET = createReportingGet('schedules', reportFiltersSchema, reportSchedulesResponseSchema)

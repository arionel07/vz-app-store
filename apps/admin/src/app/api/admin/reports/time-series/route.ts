import { reportFiltersSchema, reportTimeSeriesResponseSchema } from '@vizaje/contracts'
import { createReportingGet } from '@/lib/reporting-bff'

export const dynamic = 'force-dynamic'
export const GET = createReportingGet('time-series', reportFiltersSchema, reportTimeSeriesResponseSchema)

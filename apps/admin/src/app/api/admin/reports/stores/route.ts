import { reportPageFiltersSchema, reportStoresResponseSchema } from '@vizaje/contracts'
import { createReportingGet } from '@/lib/reporting-bff'

export const dynamic = 'force-dynamic'
export const GET = createReportingGet('stores', reportPageFiltersSchema, reportStoresResponseSchema)

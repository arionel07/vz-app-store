import { describe, expect, test } from 'bun:test'
import { reportMetricKeySchema, reportOverviewResponseSchema, reportTimeSeriesPointSchema } from '@vizaje/contracts'
import { mapDailyChartPoints } from '../src/components/reporting-charts'
import {
	defaultCustomPeriod,
	formatReportPercent,
	isCurrentReportingResult,
	mergeReportingSearch,
	reportErrorMessage,
	reportingRequestKey,
	REPORT_OPERATION_LINKS,
	REPORT_TIMEZONE,
	validateReportFilters,
} from '../src/lib/reporting-state'

const storeId = '00000000-0000-4000-8000-000000000001'
const employeeId = '00000000-0000-4000-8000-000000000002'

describe('reporting dashboard state and data mapping', () => {
	test('uses the documented Chisinau calendar date for defaults and validates inclusive boundaries', () => {
		expect(defaultCustomPeriod(new Date('2025-12-31T22:30:00.000Z'))).toEqual({ startDate: '2025-12-03', endDate: '2026-01-01' })
		expect(REPORT_TIMEZONE).toBe('Europe/Chisinau')
		expect(validateReportFilters({ period: 'custom', startDate: '2025-01-01', endDate: '2026-01-01' }).error).toBeNull()
		expect(validateReportFilters({ period: 'custom', startDate: '2025-01-01', endDate: '2026-01-02' }).error).toContain('366')
		expect(validateReportFilters({ period: 'custom', startDate: '2026-03-02', endDate: '2026-03-01' }).error).toContain('позже')
		expect(validateReportFilters({ period: 'custom', startDate: '2026-02-30', endDate: '2026-03-01' }).error).toContain('корректные')
	})

	test('persists filters and view in the URL and resets pagination after scope changes', () => {
		const result = mergeReportingSearch(`view=employees&period=custom&startDate=2026-01-01&endDate=2026-01-31&storeId=${storeId}&employeeId=${employeeId}&page=4`, { storeId: null, employeeId: null })
		const query = new URLSearchParams(result)
		expect(query.get('view')).toBe('employees')
		expect(query.get('period')).toBe('custom')
		expect(query.get('startDate')).toBe('2026-01-01')
		expect(query.has('storeId')).toBe(false)
		expect(query.has('employeeId')).toBe(false)
		expect(query.get('page')).toBe('1')
	})

	test('keys results by view, date and store scope to suppress stale cross-scope responses', () => {
		const base = { period: 'last_30_days' as const, timezone: REPORT_TIMEZONE }
		const first = reportingRequestKey('stores', { ...base, storeId }, 1)
		const changedScope = reportingRequestKey('stores', { ...base, storeId: employeeId }, 1)
		const changedPeriod = reportingRequestKey('stores', { ...base, period: 'last_7_days', storeId }, 1)
		expect(isCurrentReportingResult(first, first)).toBe(true)
		expect(isCurrentReportingResult(first, changedScope)).toBe(false)
		expect(isCurrentReportingResult(first, changedPeriod)).toBe(false)
	})

	test('preserves zero/null API metrics and maps only returned time-series points without filling dates', () => {
		const overview = reportOverviewResponseSchema.parse({
			period: { preset: 'custom', startDate: '2026-01-01', endDate: '2026-01-02', startAt: '2025-12-31T22:00:00.000Z', endAt: '2026-01-01T22:00:00.000Z', endExclusive: true, timezone: REPORT_TIMEZONE, snapshotAt: '2026-01-03T00:00:00.000Z' },
			metrics: { activeStoreCount: 0, activeAssignedEmployeeCount: 0, participatingStoreCount: 0, assignedTaskCount: 0, checkedTaskCount: 0, outstandingReviewCount: 0, taskCompletionRate: null },
		})
		expect(overview.metrics).toMatchObject({ activeStoreCount: 0, taskCompletionRate: null })
		expect(formatReportPercent(overview.metrics.taskCompletionRate)).toBe('—')
		const point = reportTimeSeriesPointSchema.parse({ localDate: '2026-01-01', taskOccurrencesCreated: 0, photoVersionsSubmitted: 2, quizAttemptsSubmitted: 0, campaignSubmissions: 0, merchandisingInspectionsSubmitted: 0, issuesCreated: 0, requestsCreated: 0 })
		expect(mapDailyChartPoints([point], 'photoVersionsSubmitted')).toEqual([{ localDate: '2026-01-01', value: 2 }])
		expect(mapDailyChartPoints([point], 'taskOccurrencesCreated')).toEqual([{ localDate: '2026-01-01', value: 0 }])
		expect(mapDailyChartPoints([], 'taskOccurrencesCreated')).toEqual([])
		expect(reportMetricKeySchema.safeParse('taskCompletionRate').success).toBe(true)
	})

	test('maps authorization and stale-resource API errors to explicit Russian feedback', () => {
		const error = (status: number) => Object.assign(new Error('upstream'), { status })
		expect(reportErrorMessage(error(401))).toContain('Сеанс завершён')
		expect(reportErrorMessage(error(403))).toContain('нет доступа')
		expect(reportErrorMessage(error(404))).toContain('Сбросьте фильтр')
		expect(reportErrorMessage(error(409))).toContain('Данные изменились')
	})

	test('links only to the four existing scoped operations modules', () => {
		expect(REPORT_OPERATION_LINKS.map((link) => link.href)).toEqual([
			'/operations/campaigns', '/operations/merchandising', '/operations/issues', '/operations/requests',
		])
	})
})

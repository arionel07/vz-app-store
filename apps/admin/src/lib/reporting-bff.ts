import { NextResponse } from 'next/server'
import { isNextResponse, parseWithSchema, proxyManagement } from '@/lib/management-bff'

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false; error?: { issues?: Array<{ message?: string }> } } }

export function createReportingGet<TQuery extends object, TResponse>(
	endpoint: string,
	querySchema: Schema<TQuery>,
	responseSchema: Schema<TResponse>,
): (request: Request) => Promise<NextResponse> {
	return async (request) => {
		const url = new URL(request.url)
		const parsed = parseWithSchema(querySchema, Object.fromEntries(url.searchParams.entries()))
		if (isNextResponse(parsed)) return parsed

		const query = new URLSearchParams()
		for (const [key, value] of Object.entries(parsed)) {
			if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
		}
		const suffix = query.size ? `?${query.toString()}` : ''
		return proxyManagement(request, `/api/v1/management/reports/${endpoint}${suffix}`, responseSchema)
	}
}

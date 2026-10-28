import { NextResponse } from 'next/server'
import {
	fetchManagementApi,
	forwardBffResponse,
	getManagementRequestOptions,
	jsonError,
	managementUnavailableResponse,
	type BffFetchOptions,
} from '@/lib/auth'

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false; error?: { issues?: Array<{ message?: string }> } } }

export async function readJsonBody(request: Request): Promise<unknown> {
	try {
		return await request.json()
	} catch {
		return null
	}
}

export function validationError(message: string): NextResponse {
	return jsonError(400, 'VALIDATION_ERROR', message)
}

export function parseWithSchema<T>(schema: Schema<T>, value: unknown): T | NextResponse {
	const parsed = schema.safeParse(value)
	return parsed.success ? parsed.data : validationError(parsed.error?.issues?.[0]?.message ?? 'Некорректные данные')
}

export function queryFromSearchParams(searchParams: URLSearchParams, values: Record<string, string | number | boolean | undefined>): string {
	const query = new URLSearchParams(searchParams)
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined) query.set(key, String(value))
	}
	return query.toString()
}

export async function proxyManagement<T>(
	request: Request,
	path: string,
	schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
	options: { method: BffFetchOptions['method']; body?: string } = { method: 'GET' },
): Promise<NextResponse> {
	try {
		const upstream = await fetchManagementApi(path, getManagementRequestOptions(request, { ...options, method: options.method ?? 'GET' }))
		return forwardBffResponse(upstream, schema, {
			invalidResponseMessage: 'Сервис управления вернул некорректные данные',
			fallbackErrorCode: 'MANAGEMENT_REQUEST_FAILED',
			fallbackErrorMessage: 'Запрос управления не выполнен',
		})
	} catch {
		return managementUnavailableResponse()
	}
}

export async function proxyManagementNoContent(request: Request, path: string, options: { method: BffFetchOptions['method']; body?: string }): Promise<NextResponse> {
	try {
		const upstream = await fetchManagementApi(path, getManagementRequestOptions(request, { ...options, method: options.method ?? 'GET' }))
		if (upstream.ok) return new NextResponse(null, { status: upstream.status, headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie' } })
		return forwardBffResponse(upstream, { safeParse: (value: unknown) => value === null ? { success: true, data: null } : { success: false } }, {
			fallbackErrorCode: 'MANAGEMENT_REQUEST_FAILED',
			fallbackErrorMessage: 'Запрос управления не выполнен',
		})
	} catch {
		return managementUnavailableResponse()
	}
}

export function isNextResponse(value: unknown): value is NextResponse {
	return value instanceof NextResponse
}

export function parseUuid(value: string | undefined, label: string): string | NextResponse {
	if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
		return validationError(`${label} имеет некорректный идентификатор`)
	}
	return value
}

import { logoutResponseSchema, setUserPasswordRequestSchema } from '@vizaje/contracts'
import { NextResponse } from 'next/server'
import {
	backendUnavailableResponse,
	fetchAuthApi,
	forwardAuthResponse,
	getAuthRequestOptions,
	jsonError,
	getSessionCookieHeader,
} from '@/lib/auth'
import { isNextResponse, parseUuid, readJsonBody } from '@/lib/management-bff'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	const id = parseUuid((await context.params).id, 'Сотрудник')
	if (isNextResponse(id)) return id
	const parsed = setUserPasswordRequestSchema.safeParse(await readJsonBody(request))
	if (!parsed.success) return jsonError(400, 'VALIDATION_ERROR', 'Пароль должен содержать не менее 12 символов')

	const sessionCookie = getSessionCookieHeader(request.headers.get('cookie'))
	if (!sessionCookie) return jsonError(401, 'UNAUTHENTICATED', 'Authentication is required')

	try {
		const upstream = await fetchAuthApi('/api/v1/auth/staff-password', {
			...getAuthRequestOptions(request, { method: 'POST', body: JSON.stringify({ userId: id, password: parsed.data.password }) }),
			cookieHeader: sessionCookie,
		})
		return forwardAuthResponse(upstream, logoutResponseSchema, {
			invalidResponseMessage: 'Сервис авторизации вернул некорректный ответ',
			fallbackErrorCode: 'PASSWORD_REQUEST_FAILED',
			fallbackErrorMessage: 'Не удалось обновить пароль сотрудника',
		})
	} catch {
		return backendUnavailableResponse()
	}
}

import { adminLoginRequestSchema, browserLoginResponseSchema } from '@/lib/auth'
import { backendUnavailableResponse, fetchAuthApi, forwardAuthResponse, jsonError } from '@/lib/auth'

export async function POST(request: Request) {
	const body = await request.json().catch(() => null)
	const parsed = adminLoginRequestSchema.safeParse(body)
	if (!parsed.success) return jsonError(400, 'VALIDATION_ERROR', 'Введите корректный email и пароль')

	try {
		const upstream = await fetchAuthApi('/api/v1/auth/login', {
			method: 'POST',
			body: JSON.stringify(parsed.data),
			userAgent: request.headers.get('user-agent'),
		})
		return forwardAuthResponse(upstream, browserLoginResponseSchema, { forwardSetCookies: true })
	} catch {
		return backendUnavailableResponse()
	}
}

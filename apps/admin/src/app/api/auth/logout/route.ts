import { logoutResponseSchema } from '@/lib/auth'
import { backendUnavailableResponse, fetchAuthApi, forwardAuthResponse, getSessionCookieHeader, jsonError } from '@/lib/auth'

export async function POST(request: Request) {
	const sessionCookie = getSessionCookieHeader(request.headers.get('cookie'))
	if (!sessionCookie) return jsonError(401, 'UNAUTHENTICATED', 'Authentication is required')

	try {
		const upstream = await fetchAuthApi('/api/v1/auth/logout', {
			method: 'POST',
			cookieHeader: sessionCookie,
			csrfToken: request.headers.get('x-csrf-token'),
		})
		return forwardAuthResponse(upstream, logoutResponseSchema, { forwardSetCookies: true })
	} catch {
		return backendUnavailableResponse()
	}
}

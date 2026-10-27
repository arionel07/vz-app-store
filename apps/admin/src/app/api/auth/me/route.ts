import { userResponseSchema } from '@/lib/auth'
import { fetchAuthApi, forwardAuthResponse, getSessionCookieHeader, jsonError, backendUnavailableResponse } from '@/lib/auth'

export async function GET(request: Request) {
	const sessionCookie = getSessionCookieHeader(request.headers.get('cookie'))
	if (!sessionCookie) return jsonError(401, 'UNAUTHENTICATED', 'Authentication is required')

	try {
		const upstream = await fetchAuthApi('/api/v1/auth/me', { cookieHeader: sessionCookie })
		return forwardAuthResponse(upstream, userResponseSchema)
	} catch {
		return backendUnavailableResponse()
	}
}

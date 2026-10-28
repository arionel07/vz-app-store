import { ApiError } from '../api/client'

export function mobileLoginErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === 'RATE_LIMITED' || error.status === 429) return 'Слишком много попыток. Повторите вход позже.'
		if (error.status === 0) return 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.'
		if (error.status >= 500) return 'Сервис временно недоступен. Повторите попытку позже.'
	}
	return 'Не удалось войти. Проверьте email и пароль.'
}

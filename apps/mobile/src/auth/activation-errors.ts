import { ApiError, isNetworkError } from '../api/client'

export function activationError(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === 'INVALID_ACTIVATION' || error.status === 401) return 'Код недействителен, уже использован или срок его действия истёк.'
		if (error.code === 'RATE_LIMITED' || error.status === 429) return 'Слишком много попыток. Получите новый код и повторите позже.'
		if (isNetworkError(error)) return 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.'
	}
	return 'Не удалось активировать приложение. Повторите попытку или запросите новый QR-код.'
}

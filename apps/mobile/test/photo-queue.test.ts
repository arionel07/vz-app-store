import { describe, expect, test } from 'bun:test'
import { canStartUpload, createQueueItem, markFailed, markUploaded, markUploading } from '../src/photos/upload-queue'
import type { PreparedPhoto } from '../src/photos/image-processing-logic'
import type { PhotoResponse } from '@vizaje/contracts'

const prepared: PreparedPhoto = { uri: 'file:///photo.jpg', filename: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 1000, width: 100, height: 100 }
const photo: PhotoResponse = {
	id: '11111111-1111-4111-8111-111111111111', storeId: '22222222-2222-4222-8222-222222222222', uploadedBy: '33333333-3333-4333-8333-333333333333',
	originalFilename: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 1000, createdAt: '2026-01-01T00:00:00.000Z',
}

describe('photo upload queue', () => {
	test('keeps a stable local identity and idempotency key across manual retry', () => {
		const item = createQueueItem(prepared, photo.storeId, 'local-1', 'idem-1')
		const failed = markFailed(markUploading(item), 'Нет сети')
		const retry = markUploading(failed)
		expect(retry.localId).toBe('local-1')
		expect(retry.idempotencyKey).toBe('idem-1')
		expect(canStartUpload(failed)).toBe(true)
	})

	test('preserves successful uploads while other items can fail independently', () => {
		const first = markUploaded(markUploading(createQueueItem(prepared, photo.storeId, 'local-1', 'idem-1')), photo)
		const second = markFailed(markUploading(createQueueItem(prepared, photo.storeId, 'local-2', 'idem-2')), 'Сервис недоступен')
		expect(first.status).toBe('uploaded')
		expect(first.uploadedPhoto?.id).toBe(photo.id)
		expect(second.status).toBe('failed')
		expect(canStartUpload(first)).toBe(false)
	})
})

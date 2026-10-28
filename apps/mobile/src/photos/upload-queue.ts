import type { PhotoResponse } from '@vizaje/contracts'
import type { PreparedPhoto } from './image-processing-logic'

export type UploadStatus = 'ready' | 'uploading' | 'uploaded' | 'failed'

export type UploadQueueItem = PreparedPhoto & {
	localId: string
	storeId: string
	idempotencyKey: string
	status: UploadStatus
	errorMessage?: string
	uploadedPhoto?: PhotoResponse
}

export function createQueueItem(prepared: PreparedPhoto, storeId: string, localId: string, idempotencyKey: string): UploadQueueItem {
	return { ...prepared, localId, storeId, idempotencyKey, status: 'ready' }
}

export function markUploading(item: UploadQueueItem): UploadQueueItem {
	return item.status === 'ready' || item.status === 'failed' ? { ...item, status: 'uploading', errorMessage: undefined } : item
}

export function markUploaded(item: UploadQueueItem, photo: PhotoResponse): UploadQueueItem {
	return { ...item, status: 'uploaded', uploadedPhoto: photo, errorMessage: undefined }
}

export function markFailed(item: UploadQueueItem, message: string): UploadQueueItem {
	return item.status === 'uploading' ? { ...item, status: 'failed', errorMessage: message } : item
}

export function canStartUpload(item: UploadQueueItem): boolean {
	return item.status === 'ready' || item.status === 'failed'
}

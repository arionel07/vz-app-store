export const MAX_PHOTOS_PER_BATCH = 10
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 4096

export type PreparedPhoto = {
	uri: string
	filename: string
	mimeType: 'image/jpeg'
	fileSize: number
	width: number
	height: number
}

export function targetDimensions(width: number, height: number, maxDimension = MAX_IMAGE_DIMENSION): { width: number; height: number } {
	if (width <= 0 || height <= 0) throw new Error('Размер изображения не определён')
	const scale = Math.min(1, maxDimension / Math.max(width, height))
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function jpegFilename(filename: string | null | undefined, fallback: string): string {
	const source = filename?.trim().replace(/\\/g, '/').split('/').pop() ?? ''
	const basename = source.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 180)
	return `${basename || fallback}.jpg`
}

export function isUploadSizeAllowed(size: number): boolean {
	return Number.isFinite(size) && size > 0 && size <= MAX_UPLOAD_BYTES
}

export function compressionCandidates(): readonly number[] {
	return [0.82, 0.68, 0.52, 0.38]
}

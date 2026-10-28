import { describe, expect, test } from 'bun:test'
import { compressionCandidates, isUploadSizeAllowed, jpegFilename, MAX_UPLOAD_BYTES, targetDimensions } from '../src/photos/image-processing-logic'

describe('photo preparation rules', () => {
	test('converts HEIC-style names to the backend-supported JPEG extension', () => {
		expect(jpegFilename('/camera/отчёт HEIC.heic', 'fallback')).toBe('отчёт-HEIC.jpg')
		expect(jpegFilename('store-front.HEIF', 'fallback')).toBe('store-front.jpg')
	})

	test('resizes only when an image exceeds the maximum dimension', () => {
		expect(targetDimensions(8000, 4000)).toEqual({ width: 4096, height: 2048 })
		expect(targetDimensions(1200, 900)).toEqual({ width: 1200, height: 900 })
	})

	test('enforces the 10 MiB preflight limit and offers bounded compression', () => {
		expect(isUploadSizeAllowed(MAX_UPLOAD_BYTES)).toBe(true)
		expect(isUploadSizeAllowed(MAX_UPLOAD_BYTES + 1)).toBe(false)
		expect(compressionCandidates()).toEqual([0.82, 0.68, 0.52, 0.38])
	})
})

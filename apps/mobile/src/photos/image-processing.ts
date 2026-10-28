import * as FileSystem from 'expo-file-system/legacy'
import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator'
import type { ImagePickerAsset } from 'expo-image-picker'
import { jpegFilename, isUploadSizeAllowed, MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES, targetDimensions, type PreparedPhoto } from './image-processing-logic'
import { compressionCandidates } from './image-processing-logic'

export { MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES, jpegFilename, isUploadSizeAllowed, targetDimensions, type PreparedPhoto } from './image-processing-logic'

export async function preparePhoto(asset: ImagePickerAsset, fallbackName: string): Promise<PreparedPhoto> {
	if (asset.type && asset.type !== 'image') throw new Error('Выбранный файл не является фотографией')
	const dimensions = targetDimensions(asset.width, asset.height)
	const resize: Action[] = dimensions.width !== asset.width || dimensions.height !== asset.height
		? [{ resize: dimensions }]
		: []
	let lastSize = 0
	for (const compress of compressionCandidates()) {
		const result = await manipulateAsync(asset.uri, resize, { format: SaveFormat.JPEG, compress })
		const info = await FileSystem.getInfoAsync(result.uri)
		if (!info.exists || info.isDirectory || info.size === undefined) {
			await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined)
			continue
		}
		lastSize = info.size
		if (isUploadSizeAllowed(info.size)) {
			return {
				uri: result.uri,
				filename: jpegFilename(asset.fileName, fallbackName),
				mimeType: 'image/jpeg',
				fileSize: info.size,
				width: result.width,
				height: result.height,
			}
		}
		await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined)
	}
	throw new Error(lastSize > MAX_UPLOAD_BYTES ? 'Фотография слишком большая после сжатия' : 'Не удалось подготовить фотографию')
}

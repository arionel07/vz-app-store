import * as Crypto from 'expo-crypto'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { uploadPhoto, type PhotoUploadFile } from '../api/client'
import { preparePhoto, type PreparedPhoto } from '../photos/image-processing'
import type { PhotoResponse } from '@vizaje/contracts'

export type SelectedOperationPhoto = PreparedPhoto & { idempotencyKey: string }

export function useOperationPhoto(maxPhotos = 5) {
	const [selected, setSelected] = useState<SelectedOperationPhoto[]>([])
	const [uploaded, setUploaded] = useState<Record<string, PhotoResponse>>({})
	const [busy, setBusy] = useState(false)
	const selectedRef = useRef(selected)

	const append = useCallback(async (assets: ImagePicker.ImagePickerAsset[]) => {
		if (!assets.length) return
		const remaining = Math.max(0, maxPhotos - selected.length)
		if (!remaining) { Alert.alert('Достигнут лимит', `Можно приложить не более ${maxPhotos} фотографий.`); return }
		setBusy(true)
		const preparedPhotos: SelectedOperationPhoto[] = []
		try {
			for (const asset of assets.slice(0, remaining)) {
				const prepared = await preparePhoto(asset, 'operation')
				preparedPhotos.push({ ...prepared, idempotencyKey: Crypto.randomUUID() })
			}
			setSelected((current) => [...current, ...preparedPhotos])
			if (assets.length > remaining) Alert.alert('Достигнут лимит', `Добавлены первые ${remaining} фото. Всего можно приложить не более ${maxPhotos}.`)
		} catch (error) {
			await Promise.all(preparedPhotos.map((photo) => FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => undefined)))
			Alert.alert('Не удалось подготовить фото', error instanceof Error ? error.message : 'Попробуйте выбрать другую фотографию.')
		} finally { setBusy(false) }
	}, [maxPhotos, selected.length])

	const choose = useCallback(async (source: 'camera' | 'gallery') => {
		if (selected.length >= maxPhotos) { Alert.alert('Достигнут лимит', `Можно приложить не более ${maxPhotos} фотографий.`); return }
		if (source === 'camera') {
			const permission = await ImagePicker.requestCameraPermissionsAsync()
			if (!permission.granted) { Alert.alert('Нужен доступ к камере', 'Разрешите доступ в настройках устройства, чтобы сделать фотографию.'); return }
			const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 })
			if (!result.canceled) await append(result.assets.slice(0, 1))
			return
		}
		const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
		if (!permission.granted) { Alert.alert('Нужен доступ к фотографиям', 'Разрешите доступ к выбранным фотографиям, чтобы приложить изображение.'); return }
		const remaining = Math.max(1, maxPhotos - selected.length)
		const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: remaining > 1, selectionLimit: remaining, quality: 1 })
		if (!result.canceled) await append(result.assets)
	}, [append, maxPhotos, selected.length])

	const clear = useCallback((idempotencyKey: string) => {
		const photo = selected.find((item) => item.idempotencyKey === idempotencyKey)
		if (photo) void FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => undefined)
		setSelected((current) => current.filter((item) => item.idempotencyKey !== idempotencyKey))
		setUploaded((current) => { const next = { ...current }; delete next[idempotencyKey]; return next })
	}, [selected])

	const upload = useCallback(async (token: string, storeId: string) => {
		const results: PhotoResponse[] = []
		for (const photo of selected) {
			const prior = uploaded[photo.idempotencyKey]
			if (prior) { results.push(prior); continue }
			const file: PhotoUploadFile = { uri: photo.uri, name: photo.filename, type: photo.mimeType }
			const result = await uploadPhoto(token, storeId, file, photo.idempotencyKey)
			setUploaded((current) => ({ ...current, [photo.idempotencyKey]: result }))
			results.push(result)
		}
		return results
	}, [selected, uploaded])

	useEffect(() => { selectedRef.current = selected }, [selected])
	useEffect(() => () => { for (const photo of selectedRef.current) void FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => undefined) }, [])
	return { selected, uploaded, busy, maxPhotos, choose, clear, upload }
}

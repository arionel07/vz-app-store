import * as Crypto from 'expo-crypto'
import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { ApiError, createOperationRequest } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/auth-context'
import { ActionButton, InlineMessage, Screen, ScreenHeader } from '../../../src/components/ui'
import { SelectedPhotoCard } from '../../../src/operations/components'
import { ChoiceChips } from '../../../src/operations/form-components'
import { operationErrorMessage, requestCategories } from '../../../src/operations/model'
import { MissingStore } from '../../../src/operations/route-ui'
import { useSelectedOperationStore } from '../../../src/operations/store-hook'
import { useOperationPhoto } from '../../../src/operations/use-operation-photo'
import { useAppTheme } from '../../../src/theme'

type RequestCategory = typeof requestCategories[number][0]

export default function NewRequestScreen() {
	const params = useLocalSearchParams<{ storeId?: string }>()
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const [category, setCategory] = useState<RequestCategory>('supplies')
	const [description, setDescription] = useState('')
	const [quantity, setQuantity] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [key, setKey] = useState(() => Crypto.randomUUID())
	const photo = useOperationPhoto()
	const photoSignature = photo.selected.map((item) => item.idempotencyKey).join('|')
	useEffect(() => { setKey(Crypto.randomUUID()) }, [photoSignature])
	const changed = <T,>(setter: (value: T) => void, value: T) => { setter(value); setKey(Crypto.randomUUID()) }
	const submit = async () => {
		if (!store || !description.trim() || busy) return
		setBusy(true); setError(null)
		try {
			const created = await requestAuthenticated(async (token) => {
				const uploaded = await photo.upload(token, store.id)
				return createOperationRequest(token, { storeId: store.id, category, description, ...(quantity.trim() ? { quantity: quantity.trim() } : {}), attachmentPhotoIds: uploaded.map((item) => item.id) }, key)
			})
			router.replace(`/operations/requests/${created.id}?storeId=${store.id}`)
		} catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && reason.status === 409) setKey(Crypto.randomUUID()) }
		finally { setBusy(false) }
	}
	return <Screen keyboardAware><ScreenHeader title="Новая заявка" back backFallback={`/operations/requests?storeId=${store?.id ?? ''}`} />
		{!store ? <MissingStore stores={stores} /> : <>
			<Text style={[styles.store, { color: colors.muted }]}>Магазин: {store.name}</Text>
			<ChoiceChips disabled={busy} label="Тип заявки" value={category} options={requestCategories} onChange={(value) => changed(setCategory, value)} />
			<View style={styles.field}><Text style={[styles.label, { color: colors.text }]}>Что требуется</Text><TextInput editable={!busy} accessibilityLabel="Описание заявки" value={description} onChangeText={(value) => changed(setDescription, value)} maxLength={5000} multiline textAlignVertical="top" placeholder="Опишите, что нужно магазину" placeholderTextColor={colors.muted} style={[styles.input, styles.textArea, { backgroundColor: colors.surfaceRaised, color: colors.text, borderColor: colors.border }]} /></View>
			<View style={styles.field}><Text style={[styles.label, { color: colors.text }]}>Количество (необязательно)</Text><TextInput editable={!busy} accessibilityLabel="Количество" value={quantity} onChangeText={(value) => changed(setQuantity, value)} maxLength={300} placeholder="Например, 4 шт." placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surfaceRaised, color: colors.text, borderColor: colors.border }]} /></View>
			<SelectedPhotoCard photos={photo.selected} busy={photo.busy} disabled={busy} onCamera={() => void photo.choose('camera')} onGallery={() => void photo.choose('gallery')} onRemove={photo.clear} />
			{error && <InlineMessage title="Не удалось отправить заявку" body={error} actionLabel="Повторить" onAction={() => void submit()} />}
			<ActionButton label={busy ? 'Отправляем…' : 'Отправить заявку'} disabled={busy || !description.trim()} onPress={() => void submit()} />
			{busy && <ActivityIndicator color={colors.accent} />}
		</>}
	</Screen>
}

const styles = StyleSheet.create({ store: { fontSize: 14 }, field: { gap: 8 }, label: { fontSize: 15, fontWeight: '600' }, input: { minHeight: 52, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, fontSize: 16 }, textArea: { minHeight: 140, paddingTop: 14 } })

import * as Crypto from 'expo-crypto'
import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { ApiError, createOperationIssue } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/auth-context'
import { ActionButton, InlineMessage, Screen, ScreenHeader } from '../../../src/components/ui'
import { SelectedPhotoCard } from '../../../src/operations/components'
import { ChoiceChips } from '../../../src/operations/form-components'
import { issueCategories, operationErrorMessage } from '../../../src/operations/model'
import { MissingStore } from '../../../src/operations/route-ui'
import { useSelectedOperationStore } from '../../../src/operations/store-hook'
import { useOperationPhoto } from '../../../src/operations/use-operation-photo'
import { useAppTheme } from '../../../src/theme'

type IssueCategory = typeof issueCategories[number][0]
type Priority = 'low' | 'normal' | 'high' | 'urgent'
const priorities: readonly (readonly [Priority, string])[] = [['low', 'Низкий'], ['normal', 'Обычный'], ['high', 'Высокий'], ['urgent', 'Срочный']]

export default function NewIssueScreen() {
	const params = useLocalSearchParams<{ storeId?: string }>()
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const [category, setCategory] = useState<IssueCategory>('equipment')
	const [priority, setPriority] = useState<Priority>('normal')
	const [title, setTitle] = useState('')
	const [description, setDescription] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [key, setKey] = useState(() => Crypto.randomUUID())
	const photo = useOperationPhoto()
	const photoSignature = photo.selected.map((item) => item.idempotencyKey).join('|')
	useEffect(() => { setKey(Crypto.randomUUID()) }, [photoSignature])
	const update = <T,>(setter: (value: T) => void, value: T) => { setter(value); setKey(Crypto.randomUUID()) }
	const submit = async () => {
		if (!store || !title.trim() || !description.trim() || busy) return
		setBusy(true); setError(null)
		try {
			const created = await requestAuthenticated(async (token) => {
				const uploaded = await photo.upload(token, store.id)
				return createOperationIssue(token, { storeId: store.id, category, title, description, priority, photoIds: uploaded.map((item) => item.id) }, key)
			})
			router.replace(`/operations/issues/${created.id}?storeId=${store.id}`)
		} catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && reason.status === 409) setKey(Crypto.randomUUID()) }
		finally { setBusy(false) }
	}
	return <Screen keyboardAware><ScreenHeader title="Сообщить о проблеме" back backFallback={`/operations/issues?storeId=${store?.id ?? ''}`} />
		{!store ? <MissingStore stores={stores} /> : <>
			<Text style={[styles.store, { color: colors.muted }]}>Магазин: {store.name}</Text>
			<ChoiceChips disabled={busy} label="Категория" value={category} options={issueCategories} onChange={(value) => update(setCategory, value)} />
			<ChoiceChips disabled={busy} label="Приоритет" value={priority} options={priorities} onChange={(value) => update(setPriority, value)} />
			<View style={styles.field}><Text style={[styles.label, { color: colors.text }]}>Кратко опишите проблему</Text><TextInput editable={!busy} accessibilityLabel="Название проблемы" value={title} onChangeText={(value) => update(setTitle, value)} maxLength={200} placeholder="Например, не работает терминал" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surfaceRaised, color: colors.text, borderColor: colors.border }]} /></View>
			<View style={styles.field}><Text style={[styles.label, { color: colors.text }]}>Подробности</Text><TextInput editable={!busy} accessibilityLabel="Описание проблемы" value={description} onChangeText={(value) => update(setDescription, value)} maxLength={5000} multiline textAlignVertical="top" placeholder="Что произошло и где именно?" placeholderTextColor={colors.muted} style={[styles.input, styles.textArea, { backgroundColor: colors.surfaceRaised, color: colors.text, borderColor: colors.border }]} /></View>
			<SelectedPhotoCard photos={photo.selected} busy={photo.busy} disabled={busy} onCamera={() => void photo.choose('camera')} onGallery={() => void photo.choose('gallery')} onRemove={photo.clear} />
			{error && <InlineMessage title="Не удалось отправить обращение" body={error} actionLabel="Повторить" onAction={() => void submit()} />}
			<ActionButton label={busy ? 'Отправляем…' : 'Отправить обращение'} disabled={busy || !title.trim() || !description.trim()} onPress={() => void submit()} />
			{busy && <ActivityIndicator color={colors.accent} />}
		</>}
	</Screen>
}

const styles = StyleSheet.create({ store: { fontSize: 14 }, field: { gap: 8 }, label: { fontSize: 15, fontWeight: '600' }, input: { minHeight: 52, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, fontSize: 16 }, textArea: { minHeight: 132, paddingTop: 14 }, })

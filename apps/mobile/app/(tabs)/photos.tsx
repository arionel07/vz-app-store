import * as Crypto from 'expo-crypto'
import * as ImagePicker from 'expo-image-picker'
import { Image } from 'expo-image'
import { useFocusEffect, useRouter } from 'expo-router'
import { Camera, Check, CircleAlert, Image as ImageIcon, Inbox, LoaderCircle, RefreshCw, Store, Upload, X } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { ApiError, downloadPhotoImage, listPhotos, uploadPhoto } from '../../src/api/client'
import { ActionButton, Card, EmptyState, InlineMessage, Screen, ScreenHeader, SectionTitle } from '../../src/components/ui'
import { useAuth } from '../../src/auth/auth-context'
import { preparePhoto } from '../../src/photos/image-processing'
import { canStartUpload, createQueueItem, markFailed, markUploaded, markUploading, type UploadQueueItem } from '../../src/photos/upload-queue'
import { availableStoreSelection, isAuthorizedStore } from '../../src/photos/store-selection'
import { useAppTheme } from '../../src/theme'
import type { PhotoResponse, StoreResponse } from '@vizaje/contracts'

const MAX_PHOTOS_PER_BATCH = 10
const MAX_HISTORY_PAGE_SIZE = 20

function errorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.status === 401) return 'Сессия закончилась. Войдите в приложение снова.'
		if (error.status === 403) return 'У вас нет доступа к этому магазину.'
		if (error.status === 404) return 'Фотография больше недоступна.'
		if (error.status === 413) return 'Фотография слишком большая для загрузки.'
		if (error.status === 409) return 'Эта фотография уже загружается с другим ключом.'
		if (error.code === 'UPLOAD_CANCELLED') return 'Загрузка отменена. Её можно повторить.'
		if (error.status >= 500) return 'Сервис временно недоступен. Попробуйте позже.'
		return error.message
	}
	return 'Не удалось выполнить операцию. Проверьте соединение и попробуйте снова.'
}

function dateLabel(value: string): string {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? 'Дата неизвестна' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PhotosScreen() {
	const { colors } = useAppTheme()
	const router = useRouter()
	const { user, requestAuthenticated } = useAuth()
	const stores = user?.assignedStores ?? []
	const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
	const [queue, setQueue] = useState<UploadQueueItem[]>([])
	const [notice, setNotice] = useState<string | null>(null)
	const [permissionNotice, setPermissionNotice] = useState(false)
	const [history, setHistory] = useState<PhotoResponse[]>([])
	const [historyLoading, setHistoryLoading] = useState(false)
	const [historyRefreshing, setHistoryRefreshing] = useState(false)
	const [historyError, setHistoryError] = useState<string | null>(null)
	const [historyPage, setHistoryPage] = useState(1)
	const [historyTotalPages, setHistoryTotalPages] = useState(0)
	const [imageUris, setImageUris] = useState<Record<string, string>>({})
	const [uploading, setUploading] = useState(false)
	const imageRequests = useRef(new Set<string>())
	const imageUrisRef = useRef<Record<string, string>>({})
	const uploadAbortRef = useRef<AbortController | null>(null)
	const cancelUploadRef = useRef(false)

	const storeSelection = useMemo(() => availableStoreSelection(stores, selectedStoreId), [selectedStoreId, stores])
	const selectedStore = stores.find((store) => store.id === storeSelection.selectedStoreId)
	const pendingCount = queue.filter((item) => item.status !== 'uploaded').length

	useEffect(() => {
		setSelectedStoreId(storeSelection.selectedStoreId)
	}, [storeSelection.selectedStoreId])

	const loadHistory = useCallback(async (page = 1, reset = true) => {
		const storeId = storeSelection.selectedStoreId
		if (!isAuthorizedStore(stores, storeId)) {
			setHistoryLoading(false)
			setHistoryRefreshing(false)
			setHistory([])
			setHistoryError(null)
			setHistoryPage(1)
			setHistoryTotalPages(0)
			return
		}
		setHistoryLoading(true)
		setHistoryError(null)
		try {
			const response = await requestAuthenticated((token) => listPhotos(token, storeId, { page, pageSize: MAX_HISTORY_PAGE_SIZE }))
			setHistory((current) => reset ? response.data : [...current, ...response.data.filter((item) => !current.some((existing) => existing.id === item.id))])
			setHistoryPage(response.pagination.page)
			setHistoryTotalPages(response.pagination.totalPages)
			const imagesToLoad = response.data.filter((photo) => !imageUrisRef.current[photo.id] && !imageRequests.current.has(photo.id))
			await Promise.all(imagesToLoad.map(async (photo) => {
				imageRequests.current.add(photo.id)
				try {
					const uri = await requestAuthenticated((token) => downloadPhotoImage(token, photo))
					setImageUris((current) => {
						const next = { ...current, [photo.id]: uri }
						imageUrisRef.current = next
						return next
					})
				} catch {
					// Metadata remains visible when a protected preview is unavailable.
				} finally {
					imageRequests.current.delete(photo.id)
				}
			}))
		} catch (error) {
			setHistoryError(errorMessage(error))
		} finally {
			setHistoryLoading(false)
			setHistoryRefreshing(false)
		}
	}, [requestAuthenticated, storeSelection.selectedStoreId, stores])

	useFocusEffect(useCallback(() => {
		void loadHistory(1, true)
	}, [loadHistory]))

	const refreshHistory = useCallback(() => {
		setHistoryRefreshing(true)
		void loadHistory(1, true)
	}, [loadHistory])

	const pickPhotos = useCallback(async (source: 'camera' | 'library') => {
		setNotice(null)
		setPermissionNotice(false)
		if (!storeSelection.available) {
			setNotice('У вас нет активного назначенного магазина.')
			return
		}
		if (storeSelection.needsSelection) {
			setNotice('Сначала выберите магазин для загрузки.')
			return
		}
		if (queue.length >= MAX_PHOTOS_PER_BATCH) {
			setNotice('В одной загрузке может быть не больше 10 фотографий.')
			return
		}
		const permission = source === 'camera'
			? await ImagePicker.requestCameraPermissionsAsync()
			: await ImagePicker.requestMediaLibraryPermissionsAsync(false)
		if (!permission.granted) {
			setPermissionNotice(true)
			return
		}
		const result = source === 'camera'
			? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
			: await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS_PER_BATCH, quality: 1 })
		if (result.canceled) return
		const availableSlots = MAX_PHOTOS_PER_BATCH - queue.length
		const assets = result.assets.slice(0, availableSlots)
		const prepared: UploadQueueItem[] = []
		const failed: string[] = []
		for (const asset of assets) {
			try {
				const photo = await preparePhoto(asset, `photo-${Crypto.randomUUID()}`)
				prepared.push(createQueueItem(photo, storeSelection.selectedStoreId!, Crypto.randomUUID(), Crypto.randomUUID()))
			} catch (error) {
				failed.push(error instanceof Error ? error.message : 'Не удалось подготовить фотографию')
			}
		}
		if (prepared.length) setQueue((current) => [...current, ...prepared])
		if (failed.length || result.assets.length > assets.length) setNotice(failed[0] ?? 'Выбрано больше 10 фотографий. Лишние файлы не добавлены.')
	}, [queue.length, storeSelection.available, storeSelection.needsSelection, storeSelection.selectedStoreId])

	const uploadOne = useCallback(async (localId: string): Promise<boolean> => {
		const item = queue.find((candidate) => candidate.localId === localId)
		if (!item || !canStartUpload(item) || !isAuthorizedStore(stores, item.storeId)) return false
		setQueue((current) => current.map((candidate) => candidate.localId === localId ? markUploading(candidate) : candidate))
		const abortController = new AbortController()
		uploadAbortRef.current = abortController
		try {
			const photo = await requestAuthenticated((token) => uploadPhoto(token, item.storeId, { uri: item.uri, name: item.filename, type: item.mimeType }, item.idempotencyKey, { signal: abortController.signal }), { retryUnauthorized: false })
			setQueue((current) => current.map((candidate) => candidate.localId === localId ? markUploaded(candidate, photo) : candidate))
			return true
		} catch (error) {
			setQueue((current) => current.map((candidate) => candidate.localId === localId ? markFailed(candidate, errorMessage(error)) : candidate))
			return false
		} finally {
			if (uploadAbortRef.current === abortController) uploadAbortRef.current = null
		}
	}, [queue, requestAuthenticated, stores])

	const uploadReady = useCallback(async () => {
		if (uploading) return
		const ids = queue.filter(canStartUpload).map((item) => item.localId)
		if (!ids.length) return
		setUploading(true)
		setNotice(null)
		cancelUploadRef.current = false
		try {
			for (const localId of ids) {
				if (cancelUploadRef.current) break
				await uploadOne(localId)
			}
			await loadHistory(1, true)
		} finally {
			setUploading(false)
		}
	}, [loadHistory, queue, uploadOne, uploading])

	const cancelUpload = useCallback(() => {
		cancelUploadRef.current = true
		uploadAbortRef.current?.abort()
	}, [])

	const removeItem = useCallback((item: UploadQueueItem) => {
		if (item.status === 'uploading') return
		setQueue((current) => current.filter((candidate) => candidate.localId !== item.localId))
	}, [])

	const storeName = useCallback((storeId: string) => stores.find((store) => store.id === storeId)?.name ?? 'Магазин', [stores])

	return <Screen refreshing={historyRefreshing} onRefresh={refreshHistory}>
		<ScreenHeader title="Фото" subtitle="Загрузите рабочие фотографии в назначенный магазин." />

		{stores.length > 1 && <Card style={styles.storeCard}>
			<View style={styles.storeHeading}><Store size={19} color={colors.text} /><Text style={[styles.cardTitle, { color: colors.text }]}>Магазин для загрузки</Text></View>
			<View style={styles.storeList}>{stores.map((store) => <StoreOption key={store.id} store={store} selected={store.id === storeSelection.selectedStoreId} onPress={() => setSelectedStoreId(store.id)} />)}</View>
		</Card>}
		{stores.length === 1 && <View style={[styles.selectedStore, { backgroundColor: colors.surfaceRaised }]}><Store size={17} color={colors.muted} /><Text style={[styles.selectedStoreText, { color: colors.text }]}>Магазин: {selectedStore?.name}</Text></View>}
		{stores.length === 0 && <InlineMessage title="Нет назначенного магазина" body="Загрузка фотографий станет доступна после назначения активного магазина." />}
		{permissionNotice && <InlineMessage title="Нужен доступ к фотографиям" body="Разрешите доступ в настройках устройства, чтобы выбрать или снять фотографию." actionLabel="Открыть настройки" onAction={() => void Linking.openSettings()} />}
		{notice && <InlineMessage title="Не удалось добавить фотографию" body={notice} />}

		<View style={styles.actions}>
			<ActionButton label="Открыть камеру" icon={Camera} onPress={() => void pickPhotos('camera')} disabled={uploading || !storeSelection.available || storeSelection.needsSelection} />
			<ActionButton label="Выбрать из галереи" icon={ImageIcon} variant="secondary" onPress={() => void pickPhotos('library')} disabled={uploading || !storeSelection.available || storeSelection.needsSelection} />
		</View>

		{queue.length > 0 && <View style={styles.sectionBlock}>
			<SectionTitle right={<Text style={[styles.counter, { color: colors.muted }]}>{queue.length}/10</Text>}>Подготовленные фото</SectionTitle>
			{pendingCount > 0 && <Text style={[styles.warningText, { color: colors.warning }]}>Не закрывайте приложение до завершения загрузки. Фоновые загрузки не выполняются.</Text>}
			<View style={styles.queueGrid}>{queue.map((item) => <QueueCard key={item.localId} item={item} colors={colors} onRemove={() => removeItem(item)} onRetry={() => void uploadOne(item.localId)} retryDisabled={uploading} />)}</View>
			<ActionButton label={uploading ? 'Загрузка…' : `Загрузить ${queue.filter(canStartUpload).length} фото`} icon={uploading ? LoaderCircle : Upload} onPress={() => void uploadReady()} disabled={uploading || !queue.some(canStartUpload)} />
			{uploading && <ActionButton label="Отменить загрузку" variant="secondary" onPress={cancelUpload} />}
		</View>}

		<View style={styles.sectionBlock}>
			<SectionTitle right={historyLoading ? <ActivityIndicator color={colors.muted} /> : <Pressable accessibilityLabel="Обновить историю" onPress={refreshHistory} hitSlop={10}><RefreshCw size={18} color={colors.muted} /></Pressable>}>История загрузок</SectionTitle>
			{historyError && <InlineMessage title="История недоступна" body={historyError} actionLabel="Повторить" onAction={refreshHistory} />}
			{!historyLoading && !historyError && history.length === 0 && <EmptyState icon={Inbox} title="История пока пуста" body={selectedStore ? 'Загруженные фотографии появятся здесь.' : 'Выберите активный магазин, чтобы увидеть историю.'} />}
			{history.length > 0 && <View style={styles.historyGrid}>{history.map((photo) => <HistoryCard key={photo.id} photo={photo} storeName={storeName(photo.storeId)} uri={imageUris[photo.id]} colors={colors} />)}</View>}
			{historyPage < historyTotalPages && <ActionButton label="Загрузить ещё" variant="secondary" onPress={() => void loadHistory(historyPage + 1, false)} disabled={historyLoading} />}
		</View>

		<View style={[styles.bottomNote, { borderTopColor: colors.border }]}><Text style={[styles.bottomNoteText, { color: colors.muted }]}>Доступ к фотографиям ограничен назначенными магазинами.</Text><ActionButton label="Открыть профиль" variant="quiet" onPress={() => router.push('/profile')} /></View>
	</Screen>
}

function StoreOption({ store, selected, onPress }: { store: StoreResponse; selected: boolean; onPress: () => void }) {
	const { colors } = useAppTheme()
	return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.storeOption, { borderColor: selected ? colors.text : colors.border, backgroundColor: selected ? colors.surfaceRaised : colors.surface }]}><View style={[styles.radio, { borderColor: selected ? colors.text : colors.border }]}>{selected && <View style={[styles.radioDot, { backgroundColor: colors.text }]} />}</View><Text style={[styles.storeOptionText, { color: colors.text }]}>{store.name}</Text></Pressable>
}

function QueueCard({ item, colors, onRemove, onRetry, retryDisabled }: { item: UploadQueueItem; colors: ReturnType<typeof useAppTheme>['colors']; onRemove: () => void; onRetry: () => void; retryDisabled: boolean }) {
	const status = item.status === 'uploaded' ? 'Загружено' : item.status === 'uploading' ? 'Загрузка…' : item.status === 'failed' ? 'Ошибка' : 'Готово'
	return <View style={[styles.queueCard, { borderColor: colors.border, backgroundColor: colors.surface }]}><View style={styles.previewWrap}><Image source={item.uri} contentFit="cover" style={styles.preview} /><Pressable accessibilityLabel="Удалить фото" hitSlop={8} onPress={onRemove} disabled={item.status === 'uploading'} style={[styles.removeButton, { backgroundColor: colors.surface }]}><X size={15} color={colors.text} /></Pressable></View><Text numberOfLines={1} style={[styles.fileName, { color: colors.text }]}>{item.filename}</Text><View style={styles.statusRow}>{item.status === 'uploading' ? <ActivityIndicator size="small" color={colors.muted} /> : item.status === 'uploaded' ? <Check size={15} color={colors.success} /> : item.status === 'failed' ? <CircleAlert size={15} color={colors.danger} /> : null}<Text style={[styles.statusText, { color: item.status === 'failed' ? colors.danger : item.status === 'uploaded' ? colors.success : colors.muted }]}>{status}</Text></View>{item.status === 'failed' && <Pressable onPress={onRetry} disabled={retryDisabled} accessibilityRole="button" style={{ opacity: retryDisabled ? 0.45 : 1 }}><Text style={[styles.retryText, { color: colors.text }]}>Повторить</Text></Pressable>}</View>
}

function HistoryCard({ photo, storeName, uri, colors }: { photo: PhotoResponse; storeName: string; uri?: string; colors: ReturnType<typeof useAppTheme>['colors'] }) {
	return <View style={[styles.historyCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>{uri ? <Image source={uri} contentFit="cover" style={styles.historyImage} /> : <View style={[styles.historyPlaceholder, { backgroundColor: colors.surfaceRaised }]}><LoaderCircle size={22} color={colors.muted} /></View>}<Text numberOfLines={1} style={[styles.historyStore, { color: colors.text }]}>{storeName}</Text><Text style={[styles.historyDate, { color: colors.muted }]}>{dateLabel(photo.createdAt)}</Text></View>
}

const styles = StyleSheet.create({
	storeCard: { gap: 14 },
	storeHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	cardTitle: { fontSize: 16, fontWeight: '700' },
	storeList: { gap: 8 },
	storeOption: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13 },
	storeOptionText: { flex: 1, fontSize: 15, fontWeight: '600' },
	radio: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 12 },
	radioDot: { width: 10, height: 10, borderRadius: 6 },
	selectedStore: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 14 },
	selectedStoreText: { fontSize: 14, fontWeight: '600' },
	actions: { gap: 10 },
	sectionBlock: { gap: 13 },
	counter: { fontSize: 13, fontWeight: '600' },
	warningText: { fontSize: 13, lineHeight: 18 },
	queueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
	queueCard: { width: '31.8%', minWidth: 96, gap: 5, borderWidth: 1, borderRadius: 14, padding: 7 },
	previewWrap: { position: 'relative' },
	preview: { width: '100%', aspectRatio: 1, borderRadius: 9 },
	removeButton: { position: 'absolute', top: 4, right: 4, width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
	fileName: { fontSize: 11, fontWeight: '600' },
	statusRow: { minHeight: 18, flexDirection: 'row', alignItems: 'center', gap: 4 },
	statusText: { fontSize: 11 },
	retryText: { fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
	historyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
	historyCard: { width: '48%', borderWidth: 1, borderRadius: 14, padding: 7 },
	historyImage: { width: '100%', aspectRatio: 1, borderRadius: 9 },
	historyPlaceholder: { width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
	historyStore: { marginTop: 8, fontSize: 13, fontWeight: '700' },
	historyDate: { marginTop: 3, fontSize: 12 },
	bottomNote: { gap: 6, borderTopWidth: 1, paddingTop: 16 },
	bottomNoteText: { fontSize: 13, lineHeight: 18 },
})

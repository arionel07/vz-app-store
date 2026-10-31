import { Image } from 'expo-image'
import { Camera, ImagePlus, X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { downloadOperationEvidence, type OperationEvidenceKind } from '../api/client'
import { useAuth } from '../auth/auth-context'
import { ActionButton, Card } from '../components/ui'
import { useAppTheme } from '../theme'
import type { SelectedOperationPhoto } from './use-operation-photo'

export function EvidenceImage({ kind, recordId, photoId, label }: { kind: OperationEvidenceKind; recordId: string; photoId: string; label: string }) {
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [uri, setUri] = useState<string | null>(null)
	const [failed, setFailed] = useState(false)
	const [retryCount, setRetryCount] = useState(0)
	useEffect(() => {
		let cancelled = false
		let currentUri: string | null = null
		setUri(null); setFailed(false)
		void requestAuthenticated((token) => downloadOperationEvidence(token, kind, recordId, photoId)).then((downloaded) => {
			currentUri = downloaded
			if (cancelled) void FileSystem.deleteAsync(downloaded, { idempotent: true }).catch(() => undefined)
			else setUri(downloaded)
		}).catch(() => { if (!cancelled) setFailed(true) })
		return () => { cancelled = true; if (currentUri) void FileSystem.deleteAsync(currentUri, { idempotent: true }).catch(() => undefined) }
	}, [requestAuthenticated, kind, recordId, photoId, retryCount])
	return <View style={styles.evidence}>
		<Text style={[styles.evidenceLabel, { color: colors.muted }]}>{label}</Text>
		{uri ? <Image source={{ uri }} contentFit="cover" cachePolicy="none" style={styles.evidenceImage} accessibilityLabel={label} /> : <Pressable accessibilityRole="button" accessibilityLabel={failed ? 'Повторить загрузку фотографии' : 'Загрузка фотографии'} disabled={!failed} onPress={() => setRetryCount((value) => value + 1)} style={[styles.evidencePlaceholder, { backgroundColor: colors.surfaceRaised }]}>{failed ? <Text style={{ color: colors.accent }}>Фото недоступно · Повторить</Text> : <ActivityIndicator color={colors.accent} />}</Pressable>}
	</View>
}

export function SelectedPhotoCard({ photos, busy, disabled = false, maxPhotos = 5, onCamera, onGallery, onRemove }: { photos: SelectedOperationPhoto[]; busy?: boolean; disabled?: boolean; maxPhotos?: number; onCamera: () => void; onGallery: () => void; onRemove: (idempotencyKey: string) => void }) {
	const { colors } = useAppTheme()
	return <Card style={styles.photoCard}>
		<Text style={[styles.photoTitle, { color: colors.text }]}>{maxPhotos === 1 ? 'Фотография' : `Фотографии · ${photos.length}/${maxPhotos}`}</Text>
		{photos.length ? photos.map((photo) => <View key={photo.idempotencyKey} style={styles.selectedPhotoRow}><Image source={{ uri: photo.uri }} contentFit="cover" cachePolicy="none" style={styles.selectedThumb} /><View style={styles.selectedCopy}><Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600' }}>{photo.filename}</Text><Text style={{ color: colors.muted, fontSize: 13 }}>{Math.ceil(photo.fileSize / 1024)} КБ · JPEG</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Удалить выбранное фото" disabled={disabled || busy} onPress={() => onRemove(photo.idempotencyKey)} hitSlop={8}><X color={colors.muted} size={20} /></Pressable></View>) : <Text style={{ color: colors.muted, lineHeight: 20 }}>Выберите фотографию или сделайте её сейчас. Перед отправкой можно проверить кадр.</Text>}
		{photos.length < maxPhotos && <View style={styles.photoActions}><ActionButton label="Сделать фото" icon={Camera} variant="secondary" disabled={busy || disabled} onPress={onCamera} style={styles.photoAction} /><ActionButton label={maxPhotos > 1 ? 'Выбрать фото' : 'Выбрать'} icon={ImagePlus} variant="secondary" disabled={busy || disabled} onPress={onGallery} style={styles.photoAction} /></View>}
		{busy && <ActivityIndicator color={colors.accent} />}
	</Card>
}

const styles = StyleSheet.create({
	evidence: { flex: 1, minWidth: 140, gap: 6 }, evidenceLabel: { fontSize: 13, fontWeight: '600' }, evidenceImage: { width: '100%', height: 180, borderRadius: 14, backgroundColor: '#E5E5EA' }, evidencePlaceholder: { width: '100%', height: 150, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
	photoCard: { gap: 12 }, photoTitle: { fontSize: 16, fontWeight: '600' }, selectedPhotoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, selectedThumb: { width: 68, height: 68, borderRadius: 12, backgroundColor: '#E5E5EA' }, selectedCopy: { flex: 1, gap: 4 }, photoActions: { flexDirection: 'row', gap: 8 }, photoAction: { flex: 1, paddingHorizontal: 10 },
})

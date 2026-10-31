import * as Crypto from 'expo-crypto'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { Check } from 'lucide-react-native'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { InspectionResponse } from '@vizaje/contracts'
import { ApiError, getOperationInspectionHistory, listOperationDisplays, submitOperationInspection } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/auth-context'
import { ActionButton, Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../../../src/components/ui'
import { EvidenceImage, SelectedPhotoCard } from '../../../src/operations/components'
import { MissingStore, OperationStatus } from '../../../src/operations/route-ui'
import { operationErrorMessage } from '../../../src/operations/model'
import { useSelectedOperationStore } from '../../../src/operations/store-hook'
import { useOperationPhoto } from '../../../src/operations/use-operation-photo'
import { useAppTheme } from '../../../src/theme'

type HistoryRow = { id: string; fromStatus: string | null; toStatus: string; comment: string | null; createdAt: string }

export default function MerchandisingDetailScreen() {
	const params = useLocalSearchParams<{ id: string; storeId?: string }>()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const { requestAuthenticated } = useAuth()
	const { colors } = useAppTheme()
	const [row, setRow] = useState<InspectionResponse | null>(null)
	const [history, setHistory] = useState<HistoryRow[]>([])
	const [results, setResults] = useState<boolean[]>([])
	const [note, setNote] = useState('')
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState(false)
	const [submissionKey, setSubmissionKey] = useState(() => Crypto.randomUUID())
	const photo = useOperationPhoto(1)
	const photoSignature = photo.selected.map((item) => item.idempotencyKey).join('|')
	useEffect(() => { setSubmissionKey(Crypto.randomUUID()) }, [photoSignature])
	const isInspection = Boolean(row && row.id !== row.displayId)
	const canSubmit = Boolean(row && row.active !== false && (row.status === 'draft' || row.status === 'rejected'))
	const load = useCallback(async () => {
		if (!store || !params.id) { setLoading(false); setRow(null); return }
		setLoading(true); setError(null)
		try {
			const result = await requestAuthenticated((token) => listOperationDisplays(token, store.id))
			const current = result.data.find((entry) => entry.displayId === params.id)
			if (!current) { setRow(null); setHistory([]); return }
			setRow(current); setResults(current.checklistResults); setNote(current.employeeNote ?? '')
			if (current.id !== current.displayId) {
				const audit = await requestAuthenticated((token) => getOperationInspectionHistory(token, current.id))
				setHistory(audit.data)
			} else setHistory([])
		} catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setRow(null); setHistory([]) } }
		finally { setLoading(false) }
	}, [params.id, requestAuthenticated, store])
	useEffect(() => { void load() }, [load])
	const checklist = useMemo(() => row?.checklist ?? [], [row])
	const setChecklistResult = (index: number, value: boolean) => { setResults((current) => current.map((entry, i) => i === index ? value : entry)); setSubmissionKey(Crypto.randomUUID()); setSuccess(false) }
	const submit = async () => {
		if (!store || !row || !canSubmit || !photo.selected.length || saving || results.length !== checklist.length) return
		setSaving(true); setError(null); setSuccess(false)
		try {
			await requestAuthenticated(async (token) => {
				const uploaded = (await photo.upload(token, store.id))[0]
				if (!uploaded) throw new Error('Фото не выбрано')
				return submitOperationInspection(token, row.displayId, { actualPhotoId: uploaded.id, checklistResults: results, employeeNote: note, idempotencyKey: submissionKey })
			})
			setSuccess(true); setSubmissionKey(Crypto.randomUUID()); await load()
		} catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && reason.status === 409) await load() }
		finally { setSaving(false) }
	}
	return <Screen keyboardAware refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Проверка выкладки" back backFallback={`/operations/merchandising?storeId=${store?.id ?? ''}`} />
		{!store ? <MissingStore stores={stores} /> : loading && !row ? <ActivityIndicator color={colors.accent} /> : !row ? <EmptyState icon={Check} title="Выкладка недоступна" body={error ?? 'Проверьте, что у вас есть доступ к выбранному магазину.'} /> : <>
			<View style={styles.heading}><View style={styles.titleCopy}><Text style={[styles.title, { color: colors.text }]}>{row.displayName}</Text>{row.brand ? <Text style={{ color: colors.muted }}>{row.brand}</Text> : null}</View><OperationStatus status={row.status} /></View>
			<Text style={[styles.section, { color: colors.text }]}>Эталон и текущий вид</Text>
			<View style={styles.images}><EvidenceImage kind={isInspection ? 'merchandising_inspection' : 'merchandising_display'} recordId={row.id} photoId={row.referencePhotoId} label="Эталонная фотография" />{row.actualPhotoId && <EvidenceImage kind="merchandising_inspection" recordId={row.id} photoId={row.actualPhotoId} label="Ваш предыдущий снимок" />}</View>
			{checklist.length > 0 && <><Text style={[styles.section, { color: colors.text }]}>Пункты проверки</Text><View style={styles.checklist}>{checklist.map((item, index) => <Pressable key={`${item}-${index}`} accessibilityRole="checkbox" accessibilityState={{ checked: results[index] ?? false, disabled: !canSubmit }} disabled={!canSubmit} onPress={() => setChecklistResult(index, !(results[index] ?? false))} style={[styles.checkRow, { borderColor: colors.border }]}><View style={[styles.box, { borderColor: results[index] ? colors.accent : colors.muted, backgroundColor: results[index] ? colors.accent : 'transparent' }]}>{results[index] && <Check color={colors.onAccent} size={15} />}</View><Text style={[styles.checkText, { color: colors.text }]}>{item}</Text></Pressable>)}</View></>}
			{row.comment && <InlineMessage title={row.status === 'rejected' ? 'Что нужно исправить' : 'Комментарий руководителя'} body={row.comment} />}
			{row.employeeNote && <Card><Text style={{ color: colors.muted, fontSize: 13 }}>Заметка к прошлой проверке</Text><Text style={{ color: colors.text }}>{row.employeeNote}</Text></Card>}
			{history.length > 0 && <><Text style={[styles.section, { color: colors.text }]}>История проверки</Text><View style={styles.history}>{history.map((entry) => <Text key={entry.id} style={[styles.historyText, { color: colors.muted }]}>{new Date(entry.createdAt).toLocaleDateString('ru-RU')} · {entry.toStatus === 'rejected' ? 'Нужно исправить' : entry.toStatus === 'checked' ? 'Проверено' : 'Отправлено'}{entry.comment ? ` · ${entry.comment}` : ''}</Text>)}</View></>}
			{canSubmit ? <>
				<Text style={[styles.section, { color: colors.text }]}>Сделайте актуальное фото</Text>
				<SelectedPhotoCard photos={photo.selected} maxPhotos={1} busy={photo.busy} disabled={saving} onCamera={() => void photo.choose('camera')} onGallery={() => void photo.choose('gallery')} onRemove={photo.clear} />
				<TextInput editable={!saving} accessibilityLabel="Заметка к проверке" placeholder="Заметка (необязательно)" placeholderTextColor={colors.muted} value={note} onChangeText={(value) => { setNote(value); setSubmissionKey(Crypto.randomUUID()); setSuccess(false) }} multiline maxLength={2000} style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceRaised, borderColor: colors.border }]} />
				<ActionButton label={saving ? 'Отправляем…' : row.status === 'rejected' ? 'Отправить исправление' : 'Отправить проверку'} disabled={saving || !photo.selected.length || results.length !== checklist.length} onPress={() => void submit()} />
			</> : row.status === 'submitted' ? <InlineMessage title="Проверка на рассмотрении" body="После решения руководителя здесь появится результат." /> : row.status === 'checked' ? <InlineMessage title="Проверка принята" body="Руководитель подтвердил состояние выкладки." /> : null}
			{success && <InlineMessage title="Проверка отправлена" body="Сервер подтвердил отправку фотографии и ответов." />}
			{error && <InlineMessage title="Не удалось отправить проверку" body={error} actionLabel="Повторить" onAction={() => void submit()} />}
		</>}
	</Screen>
}

const styles = StyleSheet.create({ heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }, titleCopy: { flex: 1, gap: 4 }, title: { fontSize: 21, lineHeight: 27, fontWeight: '600' }, section: { fontSize: 18, fontWeight: '600' }, images: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, checklist: { gap: 7 }, checkRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 }, box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' }, checkText: { flex: 1, fontSize: 15, lineHeight: 21 }, history: { gap: 9 }, historyText: { fontSize: 13, lineHeight: 19 }, input: { minHeight: 88, borderWidth: 1, borderRadius: 16, padding: 14, fontSize: 16, textAlignVertical: 'top' } })

import * as Crypto from 'expo-crypto'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { Check, Circle } from 'lucide-react-native'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { CampaignResponse } from '@vizaje/contracts'
import { ApiError, getOperationCampaign, getOperationCampaignHistory, submitOperationCampaign } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/auth-context'
import { ActionButton, Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../../../src/components/ui'
import { EvidenceImage, SelectedPhotoCard } from '../../../src/operations/components'
import { operationErrorMessage } from '../../../src/operations/model'
import { MissingStore, OperationStatus } from '../../../src/operations/route-ui'
import { useSelectedOperationStore } from '../../../src/operations/store-hook'
import { useOperationPhoto } from '../../../src/operations/use-operation-photo'
import { useAppTheme } from '../../../src/theme'

export default function CampaignDetailScreen() {
	const params = useLocalSearchParams<{ id: string; storeId?: string }>()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const { requestAuthenticated } = useAuth()
	const { colors } = useAppTheme()
	const [campaign, setCampaign] = useState<CampaignResponse | null>(null)
	const [history, setHistory] = useState<{ id: string; executionId: string; action: string; comment: string | null; createdAt: string }[]>([])
	const [results, setResults] = useState<boolean[]>([])
	const [note, setNote] = useState('')
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState(false)
	const [submissionKey, setSubmissionKey] = useState(() => Crypto.randomUUID())
	const photo = useOperationPhoto()
	const photoSignature = photo.selected.map((item) => item.idempotencyKey).join('|')
	useEffect(() => { setSubmissionKey(Crypto.randomUUID()) }, [photoSignature])
	const execution = useMemo(() => campaign?.executions?.find((row) => row.storeId === store?.id), [campaign, store?.id])
	const canSubmit = Boolean(campaign && execution && campaign.status === 'active' && new Date(campaign.endsAt).getTime() >= Date.now() && ['not_started', 'in_progress', 'rejected'].includes(execution.status))
	const load = useCallback(async () => {
		if (!store || !params.id) { setLoading(false); return }
		setLoading(true); setError(null)
		try {
			const result = await requestAuthenticated(async (token) => {
				const [detail, audit] = await Promise.all([getOperationCampaign(token, params.id), getOperationCampaignHistory(token, params.id)])
				return { detail, audit }
			})
			const detail = result.detail
			const currentExecution = detail.executions?.find((row) => row.storeId === store.id)
			setCampaign(detail); setResults(currentExecution?.actionResults ?? detail.requiredActions.map(() => false)); setNote(currentExecution?.employeeNote ?? ''); setHistory(result.audit.data.filter((row) => row.executionId === currentExecution?.id))
		} catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) setCampaign(null) }
		finally { setLoading(false) }
	}, [params.id, requestAuthenticated, store])
	useEffect(() => { void load() }, [load])
	const setAction = (index: number, value: boolean) => { setResults((current) => current.map((entry, i) => i === index ? value : entry)); setSubmissionKey(Crypto.randomUUID()); setSuccess(false) }
	const submit = async () => {
		if (!campaign || !store || !canSubmit || saving || results.length !== campaign.requiredActions.length || results.some((done) => !done) || (campaign.requiresPhoto && !photo.selected.length)) return
		setSaving(true); setError(null); setSuccess(false)
		try {
			await requestAuthenticated(async (token) => {
				const uploaded = await photo.upload(token, store.id)
				return submitOperationCampaign(token, campaign.id, store.id, { actionResults: results, photoIds: uploaded.map((item) => item.id), employeeNote: note, idempotencyKey: submissionKey })
			})
			setSuccess(true); setSubmissionKey(Crypto.randomUUID()); await load()
		} catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && reason.status === 409) await load() }
		finally { setSaving(false) }
	}
	return <Screen keyboardAware refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Акция" back backFallback={`/operations/campaigns?storeId=${store?.id ?? ''}`} />
		{!store ? <MissingStore stores={stores} /> : loading && !campaign ? <ActivityIndicator color={colors.accent} /> : !campaign ? <EmptyState icon={Circle} title="Акция недоступна" body={error ?? 'Она могла завершиться или быть снята с публикации.'} /> : <>
			<View style={styles.heading}><Text style={[styles.title, { color: colors.text }]}>{campaign.title}</Text><OperationStatus status={execution?.status ?? 'not_started'} /></View>
			<Text style={[styles.dates, { color: colors.muted }]}>{new Date(campaign.startsAt).toLocaleDateString('ru-RU')} — {new Date(campaign.endsAt).toLocaleDateString('ru-RU')}</Text>
			{campaign.description ? <Card><Text style={[styles.body, { color: colors.text }]}>{campaign.description}</Text></Card> : null}
			{campaign.referencePhotoIds.length > 0 && <><Text style={[styles.section, { color: colors.text }]}>Материалы</Text><View style={styles.images}>{campaign.referencePhotoIds.map((id) => <EvidenceImage key={id} kind="campaign_reference" recordId={campaign.id} photoId={id} label="Материал акции" />)}</View></>}
			{campaign.requiredActions.length > 0 && <><Text style={[styles.section, { color: colors.text }]}>Что нужно сделать</Text><View style={styles.checklist}>{campaign.requiredActions.map((action, index) => <Pressable key={`${index}-${action}`} disabled={!canSubmit || saving} accessibilityRole="checkbox" accessibilityState={{ checked: results[index] ?? false, disabled: !canSubmit || saving }} onPress={() => setAction(index, !(results[index] ?? false))} style={[styles.actionRow, { borderColor: colors.border }]}><View style={[styles.checkbox, { borderColor: results[index] ? colors.accent : colors.muted, backgroundColor: results[index] ? colors.accent : 'transparent' }]}>{results[index] && <Check size={15} color={colors.onAccent} />}</View><Text style={[styles.actionText, { color: colors.text }]}>{action}</Text></Pressable>)}</View></>}
			{execution?.reviewComment && <InlineMessage title="Комментарий руководителя" body={execution.reviewComment} />}
			{execution?.employeeNote && execution.status !== 'rejected' && <Card><Text style={{ color: colors.muted, fontSize: 13 }}>Последняя заметка</Text><Text style={{ color: colors.text }}>{execution.employeeNote}</Text></Card>}
			{history.length > 0 && <><Text style={[styles.section, { color: colors.text }]}>История выполнения</Text><View style={styles.history}>{history.map((entry) => <Text key={entry.id} style={[styles.historyText, { color: colors.muted }]}>{new Date(entry.createdAt).toLocaleString('ru-RU')} · {entry.action === 'submitted' ? 'Отправлено' : entry.action === 'checked' ? 'Проверено' : entry.action === 'rejected' ? 'Нужно исправить' : entry.action}{entry.comment ? ` · ${entry.comment}` : ''}</Text>)}</View></>}
			{execution?.evidencePhotoIds?.length ? <><Text style={[styles.section, { color: colors.text }]}>Последний отчёт</Text><View style={styles.images}>{execution.evidencePhotoIds.map((id) => <EvidenceImage key={id} kind="campaign_execution" recordId={execution.id} photoId={id} label="Фото отчёта" />)}</View></> : null}
			{canSubmit && <>
				{campaign.requiresPhoto && <Text style={[styles.hint, { color: colors.muted }]}>Для отправки требуется фотография.</Text>}
				<SelectedPhotoCard photos={photo.selected} busy={photo.busy} disabled={saving} onCamera={() => void photo.choose('camera')} onGallery={() => void photo.choose('gallery')} onRemove={photo.clear} />
				<TextInput editable={!saving} accessibilityLabel="Заметка к отчёту" placeholder="Заметка (необязательно)" placeholderTextColor={colors.muted} value={note} onChangeText={(value) => { setNote(value); setSubmissionKey(Crypto.randomUUID()); setSuccess(false) }} multiline maxLength={2000} style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceRaised, borderColor: colors.border }]} />
				<ActionButton label={saving ? 'Отправляем…' : execution?.status === 'rejected' ? 'Отправить повторно' : 'Отправить отчёт'} disabled={saving || (campaign.requiresPhoto && !photo.selected.length) || results.length !== campaign.requiredActions.length || results.some((done) => !done)} onPress={() => void submit()} />
			</>}
			{!canSubmit && execution?.status === 'submitted' && <InlineMessage title="Отчёт на проверке" body="После решения руководителя статус обновится здесь." />}
			{success && <InlineMessage title="Отчёт отправлен" body="Сервер подтвердил отправку. Статус обновлён." />}
			{error && <InlineMessage title="Не удалось отправить отчёт" body={error} actionLabel="Повторить" onAction={() => void submit()} />}
		</>}
	</Screen>
}

const styles = StyleSheet.create({ heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }, title: { flex: 1, fontSize: 22, fontWeight: '600', lineHeight: 28 }, dates: { fontSize: 14 }, section: { fontSize: 18, fontWeight: '600' }, body: { fontSize: 15, lineHeight: 22 }, checklist: { gap: 8 }, actionRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 }, checkbox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 7 }, actionText: { flex: 1, fontSize: 15, lineHeight: 21 }, images: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, history: { gap: 8 }, historyText: { fontSize: 13, lineHeight: 19 }, hint: { fontSize: 14 }, input: { minHeight: 88, borderWidth: 1, borderRadius: 16, padding: 14, fontSize: 16, textAlignVertical: 'top' } })

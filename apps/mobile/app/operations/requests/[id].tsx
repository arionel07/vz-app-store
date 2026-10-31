import { useCallback, useEffect, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { PackagePlus } from 'lucide-react-native'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { RequestResponse } from '@vizaje/contracts'
import { ApiError, getMyOperationRequest, getMyOperationRequestHistory } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/auth-context'
import { Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../../../src/components/ui'
import { EvidenceImage } from '../../../src/operations/components'
import { MissingStore, OperationStatus } from '../../../src/operations/route-ui'
import { operationErrorMessage, operationStatuses } from '../../../src/operations/model'
import { useSelectedOperationStore } from '../../../src/operations/store-hook'
import { useAppTheme } from '../../../src/theme'

type HistoryRow = { id: string; fromStatus: string | null; toStatus: string; comment: string | null; createdAt: string }

const categoryLabels: Record<string, string> = { testers: 'Тестеры', promotional_materials: 'Промоматериалы', supplies: 'Расходные материалы', assistance: 'Помощь', equipment: 'Оборудование', other: 'Другое' }

export default function RequestDetailScreen() {
	const params = useLocalSearchParams<{ id: string; storeId?: string }>()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const { requestAuthenticated } = useAuth()
	const { colors } = useAppTheme()
	const [request, setRequest] = useState<RequestResponse | null>(null)
	const [history, setHistory] = useState<HistoryRow[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const load = useCallback(async () => {
		if (!store || !params.id) { setLoading(false); return }
		setLoading(true); setError(null)
		try { const [record, audit] = await requestAuthenticated(async (token) => Promise.all([getMyOperationRequest(token, params.id), getMyOperationRequestHistory(token, params.id)])); if (record.storeId !== store.id) throw new ApiError(403, 'FORBIDDEN', 'Недоступно'); setRequest(record); setHistory(audit.data) }
		catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setRequest(null); setHistory([]) } }
		finally { setLoading(false) }
	}, [params.id, requestAuthenticated, store])
	useEffect(() => { void load() }, [load])
	return <Screen refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Заявка" back backFallback={`/operations/requests?storeId=${store?.id ?? ''}`} />
		{!store ? <MissingStore stores={stores} /> : loading && !request ? <ActivityIndicator color={colors.accent} /> : !request ? <EmptyState icon={PackagePlus} title="Заявка недоступна" body={error ?? 'Она могла быть удалена или недоступна.'} /> : <>
			<View style={styles.heading}><Text style={[styles.title, { color: colors.text }]}>{categoryLabels[request.category] ?? request.category}</Text><OperationStatus status={request.status} /></View>
			<Text style={[styles.meta, { color: colors.muted }]}>{new Date(request.createdAt).toLocaleString('ru-RU')}</Text>
			<Card style={styles.card}><Text style={[styles.description, { color: colors.text }]}>{request.description}</Text>{request.quantity && <Text style={{ color: colors.muted }}>Количество: {request.quantity}</Text>}</Card>
			{request.assignedTo && <InlineMessage title="Назначен ответственный" body="Заявка передана ответственному сотруднику." />}
			{request.decisionComment && <InlineMessage title={request.status === 'rejected' ? 'Причина отказа' : 'Комментарий руководителя'} body={request.decisionComment} />}
			{request.attachmentPhotoIds.length > 0 && <><Text style={[styles.section, { color: colors.text }]}>Приложенные фотографии</Text><View style={styles.images}>{request.attachmentPhotoIds.map((photoId) => <EvidenceImage key={photoId} kind="operational_request" recordId={request.id} photoId={photoId} label="Фото к заявке" />)}</View></>}
			{history.length > 0 && <><Text style={[styles.section, { color: colors.text }]}>История</Text><View style={styles.history}>{history.map((entry) => <Text key={entry.id} style={[styles.historyText, { color: colors.muted }]}>{new Date(entry.createdAt).toLocaleString('ru-RU')} · {operationStatuses[entry.toStatus] ?? 'Обновлено'}{entry.comment ? ` · ${entry.comment}` : ''}</Text>)}</View></>}
			{error && <InlineMessage title="Не удалось обновить заявку" body={error} actionLabel="Повторить" onAction={() => void load()} />}
		</>}
	</Screen>
}

const styles = StyleSheet.create({ heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }, title: { flex: 1, fontSize: 21, fontWeight: '600' }, meta: { fontSize: 13 }, card: { gap: 10 }, description: { fontSize: 15, lineHeight: 22 }, section: { fontSize: 18, fontWeight: '600' }, images: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, history: { gap: 8 }, historyText: { fontSize: 13, lineHeight: 19 } })

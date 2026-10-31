import { useCallback, useEffect, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { Wrench } from 'lucide-react-native'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { IssueResponse } from '@vizaje/contracts'
import { ApiError, getMyOperationIssue, getMyOperationIssueHistory } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/auth-context'
import { Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../../../src/components/ui'
import { EvidenceImage } from '../../../src/operations/components'
import { MissingStore, OperationStatus } from '../../../src/operations/route-ui'
import { operationErrorMessage } from '../../../src/operations/model'
import { useSelectedOperationStore } from '../../../src/operations/store-hook'
import { useAppTheme } from '../../../src/theme'

type HistoryRow = { id: string; action: string; fromStatus: string | null; toStatus: string | null; reason: string | null; createdAt: string }

export default function IssueDetailScreen() {
	const params = useLocalSearchParams<{ id: string; storeId?: string }>()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const { requestAuthenticated } = useAuth()
	const { colors } = useAppTheme()
	const [issue, setIssue] = useState<IssueResponse | null>(null)
	const [history, setHistory] = useState<HistoryRow[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const load = useCallback(async () => {
		if (!store || !params.id) { setLoading(false); return }
		setLoading(true); setError(null)
		try { const [record, audit] = await requestAuthenticated(async (token) => Promise.all([getMyOperationIssue(token, params.id), getMyOperationIssueHistory(token, params.id)])); if (record.storeId !== store.id) throw new ApiError(403, 'FORBIDDEN', 'Недоступно'); setIssue(record); setHistory(audit.data) }
		catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setIssue(null); setHistory([]) } }
		finally { setLoading(false) }
	}, [params.id, requestAuthenticated, store])
	useEffect(() => { void load() }, [load])
	return <Screen refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Проблема" back backFallback={`/operations/issues?storeId=${store?.id ?? ''}`} />
		{!store ? <MissingStore stores={stores} /> : loading && !issue ? <ActivityIndicator color={colors.accent} /> : !issue ? <EmptyState icon={Wrench} title="Обращение недоступно" body={error ?? 'Оно могло быть удалено или недоступно.'} /> : <>
			<View style={styles.heading}><Text style={[styles.title, { color: colors.text }]}>{issue.title}</Text><OperationStatus status={issue.status} /></View>
			<Text style={[styles.meta, { color: colors.muted }]}>{categoryLabels[issue.category] ?? 'Другое'} · {issue.priority === 'urgent' ? 'Срочно' : issue.priority === 'high' ? 'Высокий приоритет' : issue.priority === 'low' ? 'Низкий приоритет' : 'Обычный приоритет'}</Text>
			<Text style={[styles.meta, { color: colors.muted }]}>{new Date(issue.createdAt).toLocaleString('ru-RU')}</Text>
			<Card><Text style={[styles.description, { color: colors.text }]}>{issue.description}</Text></Card>
			{issue.assignedTo && <InlineMessage title="Назначен ответственный" body="Ответственный сотрудник назначен руководителем магазина." />}
			{issue.resolutionNotes && <InlineMessage title="Решение" body={issue.resolutionNotes} />}
			{issue.photoIds.length > 0 && <><Text style={[styles.section, { color: colors.text }]}>Приложенные фотографии</Text><View style={styles.images}>{issue.photoIds.map((photoId) => <EvidenceImage key={photoId} kind="store_issue" recordId={issue.id} photoId={photoId} label="Фото проблемы" />)}</View></>}
			{history.length > 0 && <><Text style={[styles.section, { color: colors.text }]}>История</Text><View style={styles.history}>{history.map((entry) => <Text key={entry.id} style={[styles.historyText, { color: colors.muted }]}>{new Date(entry.createdAt).toLocaleString('ru-RU')} · {actionLabels[entry.action] ?? 'Обновлено'}{entry.reason ? ` · ${entry.reason}` : ''}</Text>)}</View></>}
			{error && <InlineMessage title="Не удалось обновить обращение" body={error} actionLabel="Повторить" onAction={() => void load()} />}
		</>}
	</Screen>
}

const categoryLabels: Record<string, string> = { lighting: 'Освещение', shelving: 'Стеллажи', payment_terminal: 'Терминал оплаты', tester: 'Тестер', climate: 'Климат', display: 'Выкладка', equipment: 'Оборудование', other: 'Другое' }
const actionLabels: Record<string, string> = { created: 'Создано', status_changed: 'Изменён статус', assigned: 'Назначен ответственный', priority_changed: 'Изменён приоритет', resolved: 'Проблема решена', reopened: 'Обращение возобновлено' }
const styles = StyleSheet.create({ heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }, title: { flex: 1, fontSize: 21, fontWeight: '600', lineHeight: 27 }, meta: { fontSize: 13 }, description: { fontSize: 15, lineHeight: 22 }, section: { fontSize: 18, fontWeight: '600' }, images: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, history: { gap: 8 }, historyText: { fontSize: 13, lineHeight: 19 } })

import { useCallback, useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { Wrench } from 'lucide-react-native'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { IssueResponse } from '@vizaje/contracts'
import { ApiError, listMyOperationIssues } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { ActionButton, Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../../src/components/ui'
import { MissingStore, OperationStatus } from '../../src/operations/route-ui'
import { operationErrorMessage } from '../../src/operations/model'
import { useSelectedOperationStore } from '../../src/operations/store-hook'
import { useAppTheme } from '../../src/theme'

export default function IssuesScreen() {
	const params = useLocalSearchParams<{ storeId?: string }>()
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const [rows, setRows] = useState<IssueResponse[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const load = useCallback(async () => {
		if (!store) { setRows([]); setLoading(false); return }
		setLoading(true); setError(null)
		try { setRows((await requestAuthenticated((token) => listMyOperationIssues(token, store.id))).data) }
		catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && [401, 403].includes(reason.status)) setRows([]) }
		finally { setLoading(false) }
	}, [requestAuthenticated, store])
	useEffect(() => { void load() }, [load])
	return <Screen refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Проблемы" back backFallback="/operations" action={<ActionButton label="Сообщить" onPress={() => router.push(`/operations/issues/new?storeId=${store?.id ?? ''}` as Href)} />} />
		{!store ? <MissingStore stores={stores} /> : <>
			<Text style={[styles.store, { color: colors.muted }]}>{store.name}</Text>
			{error && <InlineMessage title="Не удалось загрузить обращения" body={error} actionLabel="Повторить" onAction={() => void load()} />}
			{loading && rows.length === 0 ? <ActivityIndicator color={colors.accent} /> : !error && rows.length === 0 ? <EmptyState icon={Wrench} title="Вы ещё не сообщали о проблемах" body="Создайте обращение, если оборудованию или магазину требуется внимание." /> : <View style={styles.list}>{rows.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push(`/operations/issues/${item.id}?storeId=${store.id}` as Href)}><Card style={styles.card}><View style={styles.titleRow}><Text style={[styles.title, { color: colors.text }]}>{item.title}</Text><OperationStatus status={item.status} /></View><Text style={[styles.meta, { color: colors.muted }]}>{issueCategoryLabels[item.category] ?? 'Другое'} · {item.priority === 'urgent' ? 'Срочно' : item.priority === 'high' ? 'Высокий приоритет' : item.priority === 'low' ? 'Низкий приоритет' : 'Обычный приоритет'}</Text><Text style={[styles.meta, { color: colors.muted }]}>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</Text></Card></Pressable>)}</View>}
			<ActionButton label="Сообщить о проблеме" variant="secondary" onPress={() => router.push(`/operations/issues/new?storeId=${store.id}` as Href)} />
		</>}
	</Screen>
}

const issueCategoryLabels: Record<string, string> = { lighting: 'Освещение', shelving: 'Стеллажи', payment_terminal: 'Терминал оплаты', tester: 'Тестер', climate: 'Климат', display: 'Выкладка', equipment: 'Оборудование', other: 'Другое' }
const styles = StyleSheet.create({ store: { fontSize: 14 }, list: { gap: 12 }, card: { gap: 8 }, titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }, title: { flex: 1, fontSize: 16, fontWeight: '600' }, meta: { fontSize: 13 } })

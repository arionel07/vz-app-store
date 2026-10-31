import { useCallback, useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { PackagePlus } from 'lucide-react-native'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { RequestResponse } from '@vizaje/contracts'
import { ApiError, listMyOperationRequests } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { ActionButton, Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../../src/components/ui'
import { MissingStore, OperationStatus } from '../../src/operations/route-ui'
import { operationErrorMessage } from '../../src/operations/model'
import { useSelectedOperationStore } from '../../src/operations/store-hook'
import { useAppTheme } from '../../src/theme'

export default function RequestsScreen() {
	const params = useLocalSearchParams<{ storeId?: string }>()
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const [rows, setRows] = useState<RequestResponse[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const load = useCallback(async () => {
		if (!store) { setRows([]); setLoading(false); return }
		setLoading(true); setError(null)
		try { setRows((await requestAuthenticated((token) => listMyOperationRequests(token, store.id))).data) }
		catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && [401, 403].includes(reason.status)) setRows([]) }
		finally { setLoading(false) }
	}, [requestAuthenticated, store])
	useEffect(() => { void load() }, [load])
	return <Screen refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Мои заявки" back backFallback="/operations" action={<ActionButton label="Создать" onPress={() => router.push(`/operations/requests/new?storeId=${store?.id ?? ''}` as Href)} />} />
		{!store ? <MissingStore stores={stores} /> : <>
			<Text style={[styles.store, { color: colors.muted }]}>{store.name}</Text>
			{error && <InlineMessage title="Не удалось загрузить заявки" body={error} actionLabel="Повторить" onAction={() => void load()} />}
			{loading && rows.length === 0 ? <ActivityIndicator color={colors.accent} /> : !error && rows.length === 0 ? <EmptyState icon={PackagePlus} title="Заявок пока нет" body="Создайте заявку, если магазину нужны материалы, оборудование или помощь." /> : <View style={styles.list}>{rows.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push(`/operations/requests/${item.id}?storeId=${store.id}` as Href)}><Card style={styles.card}><View style={styles.titleRow}><Text style={[styles.title, { color: colors.text }]}>{categoryLabels[item.category] ?? item.category}</Text><OperationStatus status={item.status} /></View><Text numberOfLines={2} style={[styles.description, { color: colors.muted }]}>{item.description}</Text><Text style={[styles.meta, { color: colors.muted }]}>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</Text></Card></Pressable>)}</View>}
			<ActionButton label="Создать заявку" variant="secondary" onPress={() => router.push(`/operations/requests/new?storeId=${store.id}` as Href)} />
		</>}
	</Screen>
}

const categoryLabels: Record<string, string> = { testers: 'Тестеры', promotional_materials: 'Промоматериалы', supplies: 'Расходные материалы', assistance: 'Помощь', equipment: 'Оборудование', other: 'Другое' }
const styles = StyleSheet.create({ store: { fontSize: 14 }, list: { gap: 12 }, card: { gap: 8 }, titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }, title: { flex: 1, fontSize: 16, fontWeight: '600' }, description: { fontSize: 14, lineHeight: 20 }, meta: { fontSize: 13 } })

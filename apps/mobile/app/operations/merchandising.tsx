import { useCallback, useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { ClipboardList } from 'lucide-react-native'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { InspectionResponse } from '@vizaje/contracts'
import { ApiError, listOperationDisplays } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { Card, EmptyState, InlineMessage, Screen, ScreenHeader } from '../../src/components/ui'
import { MissingStore, OperationStatus } from '../../src/operations/route-ui'
import { operationErrorMessage } from '../../src/operations/model'
import { useSelectedOperationStore } from '../../src/operations/store-hook'
import { useAppTheme } from '../../src/theme'

export default function MerchandisingListScreen() {
	const params = useLocalSearchParams<{ storeId?: string }>()
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const [rows, setRows] = useState<InspectionResponse[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const load = useCallback(async () => {
		if (!store) { setRows([]); setLoading(false); return }
		setLoading(true); setError(null)
		try { setRows((await requestAuthenticated((token) => listOperationDisplays(token, store.id))).data) }
		catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && [401, 403].includes(reason.status)) setRows([]) }
		finally { setLoading(false) }
	}, [requestAuthenticated, store])
	useEffect(() => { void load() }, [load])
	return <Screen refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Выкладка" back backFallback="/operations" />
		{!store ? <MissingStore stores={stores} /> : <>
			<Text style={[styles.store, { color: colors.muted }]}>{store.name}</Text>
			{error && <InlineMessage title="Выкладка недоступна" body={error} actionLabel="Повторить" onAction={() => void load()} />}
			{loading && rows.length === 0 ? <ActivityIndicator color={colors.accent} /> : !error && rows.length === 0 ? <EmptyState icon={ClipboardList} title="Активных выкладок нет" body="Проверки появятся после того, как руководитель назначит их магазину." /> : <View style={styles.list}>{rows.map((row) => <Pressable key={row.displayId} accessibilityRole="button" onPress={() => router.push(`/operations/merchandising/${row.displayId}?storeId=${store.id}` as Href)}><Card style={styles.card}><View style={styles.titleRow}><Text style={[styles.title, { color: colors.text }]}>{row.displayName}</Text><OperationStatus status={row.status} /></View>{row.brand ? <Text style={[styles.brand, { color: colors.muted }]}>{row.brand}</Text> : null}{row.comment && <Text style={[styles.comment, { color: row.status === 'rejected' ? colors.danger : colors.muted }]}>{row.comment}</Text>}</Card></Pressable>)}</View>}
		</>}
	</Screen>
}

const styles = StyleSheet.create({ store: { fontSize: 14 }, list: { gap: 12 }, card: { gap: 8 }, titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }, title: { flex: 1, fontSize: 17, fontWeight: '600' }, brand: { fontSize: 14 }, comment: { fontSize: 14, lineHeight: 20 } })

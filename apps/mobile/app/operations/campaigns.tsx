import { useCallback, useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { ClipboardCheck } from 'lucide-react-native'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { CampaignResponse } from '@vizaje/contracts'
import { ApiError, listOperationCampaigns } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { Card, EmptyState, InlineMessage, ProgressBar, Screen, ScreenHeader } from '../../src/components/ui'
import { OperationStatus, MissingStore } from '../../src/operations/route-ui'
import { dateRangeLabel, operationErrorMessage, operationProgress } from '../../src/operations/model'
import { useSelectedOperationStore } from '../../src/operations/store-hook'
import { useAppTheme } from '../../src/theme'

export default function CampaignListScreen() {
	const params = useLocalSearchParams<{ storeId?: string }>()
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	const [items, setItems] = useState<CampaignResponse[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const load = useCallback(async () => {
		if (!store) { setLoading(false); setItems([]); return }
		setLoading(true); setError(null)
		try { setItems((await requestAuthenticated((token) => listOperationCampaigns(token, { storeId: store.id, pageSize: 100 }))).data) }
		catch (reason) { setError(operationErrorMessage(reason)); if (reason instanceof ApiError && [401, 403].includes(reason.status)) setItems([]) }
		finally { setLoading(false) }
	}, [requestAuthenticated, store])
	useEffect(() => { void load() }, [load])
	return <Screen refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Акции" back backFallback="/operations" />
		{!store ? <MissingStore stores={stores} /> : <>
			<Text style={[styles.caption, { color: colors.muted }]}>{store.name}</Text>
			{error && <InlineMessage title="Не удалось загрузить акции" body={error} actionLabel="Повторить" onAction={() => void load()} />}
			{loading && items.length === 0 ? <ActivityIndicator color={colors.accent} /> : !error && items.length === 0 ? <EmptyState icon={ClipboardCheck} title="Акций пока нет" body="Здесь появятся опубликованные акции вашего магазина." /> : <View style={styles.list}>{items.map((campaign) => {
				const execution = campaign.executions?.find((row) => row.storeId === store.id)
				const completed = execution?.actionResults?.filter(Boolean).length ?? 0
				const total = campaign.requiredActions.length
				const progress = total ? (completed / total) * 100 : execution?.status === 'submitted' || execution?.status === 'checked' ? 100 : operationProgress(execution?.status ?? 'not_started')
				return <Pressable key={campaign.id} accessibilityRole="button" onPress={() => router.push(`/operations/campaigns/${campaign.id}?storeId=${store.id}` as Href)}><Card style={styles.card}>
					<View style={styles.cardTitleRow}><Text style={[styles.title, { color: colors.text }]}>{campaign.title}</Text><OperationStatus status={execution?.status ?? 'not_started'} /></View>
					<Text style={[styles.meta, { color: colors.muted }]}>{dateRangeLabel(campaign.startsAt, campaign.endsAt)}</Text>
					{total > 0 && <><ProgressBar value={progress} /><Text style={[styles.meta, { color: colors.muted }]}>{completed} из {total} действий выполнено</Text></>}
					{execution?.reviewComment && <Text style={[styles.comment, { color: colors.danger }]}>Комментарий: {execution.reviewComment}</Text>}
				</Card></Pressable>
			})}</View>}
		</>}
	</Screen>
}

const styles = StyleSheet.create({ caption: { fontSize: 14 }, list: { gap: 12 }, card: { gap: 10 }, cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }, title: { flex: 1, fontSize: 17, fontWeight: '600', lineHeight: 22 }, meta: { fontSize: 14, lineHeight: 20 }, comment: { fontSize: 14, lineHeight: 20 } })

import { useCallback, useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ClipboardList } from 'lucide-react-native'
import { ActivityIndicator } from 'react-native'
import { ApiError, getMyOperationIssue, getMyOperationRequest, getOperationCampaign, getOperationInspection, listOperationCampaigns } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/auth-context'
import { EmptyState, InlineMessage, Screen, ScreenHeader } from '../../../src/components/ui'
import { operationErrorMessage } from '../../../src/operations/model'
import { useAppTheme } from '../../../src/theme'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function onlyIgnoreMissing<T>(request: Promise<T>): Promise<T | null> {
	try { return await request } catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error }
}

export default function OperationNotificationResolver() {
	const params = useLocalSearchParams<{ id: string }>()
	const router = useRouter()
	const { colors } = useAppTheme()
	const { user, requestAuthenticated } = useAuth()
	const [loading, setLoading] = useState(true)
	const [message, setMessage] = useState<string | null>(null)
	const resolve = useCallback(async () => {
		setLoading(true); setMessage(null)
		if (!uuid.test(params.id ?? '') || !user) { setMessage('Уведомление устарело или содержит некорректную ссылку.'); setLoading(false); return }
		const stores = user.assignedStores.filter((store) => store.isActive)
		try {
			let found = false
			await requestAuthenticated(async (token) => {
				const campaign = await onlyIgnoreMissing(getOperationCampaign(token, params.id))
				if (campaign) {
					const storeId = stores.find((store) => campaign.storeIds.includes(store.id))?.id
					if (storeId) { router.replace(`/operations/campaigns/${campaign.id}?storeId=${storeId}`); found = true; return }
				}
				const issue = await onlyIgnoreMissing(getMyOperationIssue(token, params.id))
				if (issue && stores.some((store) => store.id === issue.storeId)) { router.replace(`/operations/issues/${issue.id}?storeId=${issue.storeId}`); found = true; return }
				const request = await onlyIgnoreMissing(getMyOperationRequest(token, params.id))
				if (request && stores.some((store) => store.id === request.storeId)) { router.replace(`/operations/requests/${request.id}?storeId=${request.storeId}`); found = true; return }
				const inspection = await onlyIgnoreMissing(getOperationInspection(token, params.id))
				if (inspection) { const storeId = stores.find((store) => store.id === inspection.storeId)?.id; if (storeId) { router.replace(`/operations/merchandising/${inspection.displayId}?storeId=${storeId}`); found = true; return } }
				for (const store of stores) {
					const { data } = await listOperationCampaigns(token, { storeId: store.id, pageSize: 100 })
					const campaignWithExecution = data.find((item) => item.executions?.some((execution) => execution.id === params.id && execution.storeId === store.id))
					if (campaignWithExecution) { router.replace(`/operations/campaigns/${campaignWithExecution.id}?storeId=${store.id}`); found = true; return }
				}
			})
			if (!found) setMessage('Запись недоступна. Возможно, изменилось назначение магазина или уведомление устарело.')
		} catch (reason) { setMessage(operationErrorMessage(reason)) }
		finally { setLoading(false) }
	}, [params.id, requestAuthenticated, router, user])
	useEffect(() => { void resolve() }, [resolve])
	return <Screen><ScreenHeader title="Операция" back backFallback="/operations" />{loading ? <ActivityIndicator color={colors.accent} /> : <EmptyState icon={ClipboardList} title="Операция недоступна" body={message ?? 'Ссылка не найдена.'} />}{message && !loading && <InlineMessage title="Проверьте доступ" body={message} actionLabel="Повторить" onAction={() => void resolve()} />}</Screen>
}

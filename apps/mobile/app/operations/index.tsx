import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { ClipboardCheck, ClipboardList, Wrench, PackagePlus } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Screen, ScreenHeader, Card, EmptyState } from '../../src/components/ui'
import { useAuth } from '../../src/auth/auth-context'
import { useAppTheme } from '../../src/theme'
import { useSelectedOperationStore } from '../../src/operations/store-hook'
import { StorePicker } from '../../src/operations/route-ui'

const destinations = [
	{ path: '/operations/campaigns', title: 'Акции', description: 'Назначения и отчёты по выполнению', icon: ClipboardCheck },
	{ path: '/operations/merchandising', title: 'Выкладка', description: 'Проверка оформления витрин', icon: ClipboardList },
	{ path: '/operations/issues', title: 'Сообщить о проблеме', description: 'Оборудование и состояние магазина', icon: Wrench },
	{ path: '/operations/requests', title: 'Мои заявки', description: 'Запросы и решения руководителя', icon: PackagePlus },
] as const

export default function OperationsHome() {
	const router = useRouter()
	const params = useLocalSearchParams<{ storeId?: string }>()
	const { user } = useAuth()
	const { colors } = useAppTheme()
	const { store, stores } = useSelectedOperationStore(params.storeId)
	return <Screen><ScreenHeader title="Операции" back backFallback="/(tabs)" />
		{stores.length === 0 ? <EmptyState icon={ClipboardList} title="Магазины не назначены" body="Когда руководитель назначит магазин, здесь появятся доступные операции." /> : !store ? <StorePicker stores={stores} /> : <>
			<Pressable accessibilityRole="button" onPress={() => router.replace('/operations' as Href)}><Card style={styles.store}><Text style={[styles.storeLabel, { color: colors.muted }]}>Текущий магазин</Text><Text style={[styles.storeName, { color: colors.text }]}>{store.name}</Text><Text style={{ color: colors.accent, fontWeight: '600' }}>Изменить</Text></Card></Pressable>
			<View style={styles.destinations}>{destinations.map(({ path, title, description, icon: Icon }) => <Pressable key={path} accessibilityRole="button" onPress={() => router.push(`${path}?storeId=${store.id}` as Href)}><Card style={styles.destination}><View style={[styles.icon, { backgroundColor: colors.accentSoft }]}><Icon color={colors.accent} size={21} /></View><View style={styles.destinationCopy}><Text style={[styles.destinationTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.destinationDescription, { color: colors.muted }]}>{description}</Text></View></Card></Pressable>)}</View>
			<Text style={[styles.account, { color: colors.muted }]}>{user?.firstName} · {store.code}</Text>
		</>}
	</Screen>
}

const styles = StyleSheet.create({ store: { gap: 5 }, storeLabel: { fontSize: 13 }, storeName: { fontSize: 18, fontWeight: '600' }, destinations: { gap: 10 }, destination: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 14 }, icon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, destinationCopy: { flex: 1, gap: 5 }, destinationTitle: { fontSize: 16, fontWeight: '600' }, destinationDescription: { fontSize: 13, lineHeight: 18 }, account: { textAlign: 'center', fontSize: 13 } })

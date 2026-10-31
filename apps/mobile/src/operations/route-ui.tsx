import { useRouter, type Href } from 'expo-router'
import { MapPin } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ActionButton, Card, EmptyState, InlineMessage } from '../components/ui'
import { useAppTheme } from '../theme'
import type { StoreResponse } from '@vizaje/contracts'

export function StorePicker({ stores, message = 'Выберите магазин, в котором будете работать.' }: { stores: StoreResponse[]; message?: string }) {
	const router = useRouter()
	const { colors } = useAppTheme()
	return <View style={styles.picker}><Text style={[styles.pickerMessage, { color: colors.muted }]}>{message}</Text>{stores.length ? stores.map((store) => <Pressable key={store.id} accessibilityRole="button" onPress={() => router.replace(`/operations?storeId=${store.id}` as Href)}><Card style={styles.storeCard}><MapPin color={colors.accent} size={19} /><View style={styles.storeCopy}><Text style={[styles.storeName, { color: colors.text }]}>{store.name}</Text><Text style={[styles.storeCode, { color: colors.muted }]}>{store.code}</Text></View></Card></Pressable>) : <EmptyState icon={MapPin} title="Нет доступных магазинов" body="Попросите руководителя проверить назначение в вашем профиле." />}</View>
}

export function MissingStore({ stores }: { stores: StoreResponse[] }) {
	const router = useRouter()
	const { colors } = useAppTheme()
	return <View style={styles.missing}><InlineMessage title="Сначала выберите магазин" body="Операции показывают только данные магазинов, назначенных вашему профилю." /><ActionButton label="Выбрать магазин" variant="secondary" onPress={() => router.replace('/operations')} /><StorePicker stores={stores} /></View>
}

export function OperationStatus({ status }: { status: string }) {
	const { colors } = useAppTheme()
	const color = status === 'rejected' || status === 'urgent' ? colors.danger : status === 'checked' || status === 'completed' || status === 'resolved' ? colors.success : colors.accent
	return <View style={[styles.statusPill, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.statusText, { color }]}>{statusLabels[status] ?? status}</Text></View>
}

export const statusLabels: Record<string, string> = { not_started: 'Не начато', in_progress: 'В работе', submitted: 'На проверке', checked: 'Проверено', rejected: 'Нужно исправить', draft: 'Черновик', scheduled: 'Запланировано', active: 'Активна', completed: 'Завершена', archived: 'В архиве', cancelled: 'Отменена', open: 'Открыта', resolved: 'Решена', closed: 'Закрыта', approved: 'Одобрена', in_review: 'На рассмотрении' }

export const styles = StyleSheet.create({
	picker: { gap: 12 }, pickerMessage: { fontSize: 15, lineHeight: 21 }, storeCard: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12 }, storeCopy: { flex: 1, gap: 4 }, storeName: { fontSize: 16, fontWeight: '600' }, storeCode: { fontSize: 13 }, missing: { gap: 14 }, statusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 }, statusText: { fontSize: 12, fontWeight: '600' },
})

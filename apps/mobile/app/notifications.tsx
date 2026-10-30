import { useRouter } from 'expo-router'
import { Bell, Check, Settings2 } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { acknowledgeNotification, ApiError, getNotificationPreferences, listMyNotifications, markNotificationRead, updateNotificationPreferences } from '../src/api/client'
import { useAuth } from '../src/auth/auth-context'
import { ActionButton, Card, EmptyState, IconAction, InlineMessage, Screen, ScreenHeader } from '../src/components/ui'
import { notificationTargetHref } from '../src/notifications/navigation'
import { requestAndRegisterPushDevice } from '../src/notifications/registration'
import { useAppTheme } from '../src/theme'
import type { NotificationPreferences, NotificationResponse } from '@vizaje/contracts'

const categoryLabels = { task: 'Задание', quiz: 'Тест', schedule: 'Расписание', photo: 'Фото', announcement: 'Объявление', knowledge: 'База знаний' } as const
const preferenceLabels: Array<{ key: keyof NotificationPreferences; label: string }> = [
	{ key: 'pushEnabled', label: 'Push-уведомления' },
	{ key: 'taskNotifications', label: 'Задания' },
	{ key: 'quizNotifications', label: 'Тесты и результаты' },
	{ key: 'scheduleNotifications', label: 'Расписание' },
	{ key: 'photoReviewNotifications', label: 'Проверка фотографий' },
	{ key: 'announcementNotifications', label: 'Объявления' },
]

function errorText(error: unknown): string { return error instanceof ApiError && error.status === 0 ? 'Нет соединения с сервером.' : 'Не удалось загрузить уведомления.' }

export default function NotificationsScreen() {
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [items, setItems] = useState<NotificationResponse[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [pushState, setPushState] = useState<'idle' | 'loading' | 'registered' | 'denied' | 'unavailable'>('idle')
	const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
	const [preferencesVisible, setPreferencesVisible] = useState(false)
	const [preferencesLoading, setPreferencesLoading] = useState(false)
	const [preferencesSaving, setPreferencesSaving] = useState(false)

	const load = useCallback(async () => {
		setLoading(true); setError(null)
		try { setItems((await requestAuthenticated((token) => listMyNotifications(token))).data) } catch (reason) { setError(errorText(reason)) } finally { setLoading(false) }
	}, [requestAuthenticated])
	useEffect(() => { void load() }, [load])

	async function enablePush() {
		setPushState('loading')
		const result = await requestAuthenticated((token) => requestAndRegisterPushDevice(token))
		setPushState(result)
	}

	async function open(item: NotificationResponse) {
		if (!item.readAt) { await requestAuthenticated((token) => markNotificationRead(token, item.id)).catch(() => undefined); setItems((current) => current.map((value) => value.id === item.id ? { ...value, readAt: new Date().toISOString() } : value)) }
		if (item.target) router.push(notificationTargetHref(item.target))
	}

	async function acknowledge(item: NotificationResponse) {
		await requestAuthenticated((token) => acknowledgeNotification(token, item.id)).then((updated) => setItems((current) => current.map((value) => value.id === item.id ? updated : value))).catch(() => undefined)
	}

	async function openPreferences() {
		setPreferencesVisible(true)
		if (preferences) return
		setPreferencesLoading(true)
		try { setPreferences(await requestAuthenticated((token) => getNotificationPreferences(token))) } catch { setError('Не удалось загрузить настройки уведомлений.') } finally { setPreferencesLoading(false) }
	}

	async function togglePreference(key: keyof NotificationPreferences) {
		if (!preferences || preferencesSaving) return
		const previous = preferences
		const next = { ...preferences, [key]: !preferences[key] }
		setPreferences(next); setPreferencesSaving(true)
		try { setPreferences(await requestAuthenticated((token) => updateNotificationPreferences(token, { [key]: next[key] }))) } catch { setPreferences(previous); setError('Не удалось сохранить настройку уведомлений.') } finally { setPreferencesSaving(false) }
	}

	return <Screen refreshing={loading} onRefresh={() => void load()}><ScreenHeader title="Уведомления" back action={<IconAction icon={Settings2} label="Настройки уведомлений" onPress={() => void openPreferences()} />} />
		{preferencesVisible && <Card><View style={styles.preferencesHeader}><View><Text style={[styles.preferencesTitle, { color: colors.text }]}>Настройки</Text><Text style={[styles.preferencesBody, { color: colors.muted }]}>Выберите категории для push-уведомлений.</Text></View><Pressable accessibilityLabel="Закрыть настройки" onPress={() => setPreferencesVisible(false)}><Text style={{ color: colors.muted, fontSize: 22 }}>×</Text></Pressable></View>{preferencesLoading ? <ActivityIndicator color={colors.text} /> : preferences && <View style={styles.preferenceList}>{preferenceLabels.map(({ key, label }) => <View key={key} style={styles.preferenceRow}><Text style={[styles.preferenceLabel, { color: colors.text }]}>{label}</Text><Switch value={preferences[key]} onValueChange={() => void togglePreference(key)} disabled={preferencesSaving} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={preferences[key] ? colors.accent : colors.muted} /></View>)}</View>}</Card>}
		{pushState === 'idle' && <Card><View style={styles.pushRow}><Bell color={colors.accent} size={21} /><View style={styles.pushCopy}><Text style={[styles.pushTitle, { color: colors.text }]}>Не пропускайте важное</Text><Text style={[styles.pushBody, { color: colors.muted }]}>Разрешение можно включить только здесь, когда вы готовы получать push-уведомления.</Text></View></View><ActionButton label="Включить уведомления" variant="secondary" onPress={() => void enablePush()} /></Card>}
		{pushState === 'loading' && <InlineMessage title="Подключаем уведомления" body="Проверяем разрешение устройства…" />}
		{pushState === 'denied' && <InlineMessage title="Уведомления выключены" body="Разрешите их в настройках устройства, если хотите получать push-сообщения." />}
		{pushState === 'unavailable' && <InlineMessage title="Push пока недоступен" body="Центр уведомлений работает и без push. Повторите регистрацию позже." />}
		{error && <InlineMessage title="Ошибка загрузки" body={error} actionLabel="Повторить" onAction={() => void load()} />}
		{loading && !items.length ? <ActivityIndicator color={colors.text} /> : !error && !items.length ? <EmptyState icon={Bell} title="Новых сообщений нет" body="Здесь появятся задания, результаты тестов, расписания и объявления." /> : <View style={styles.list}>{items.map((item) => <Pressable key={item.id} onPress={() => void open(item)} style={({ pressed }) => [styles.item, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}><View style={[styles.unread, { backgroundColor: item.readAt ? colors.border : colors.accent }]} /><View style={styles.itemCopy}><View style={styles.itemMeta}><Text style={[styles.category, { color: colors.accent }]}>{categoryLabels[item.category]}</Text><Text style={[styles.date, { color: colors.muted }]}>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</Text></View><Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text><Text style={[styles.itemBody, { color: colors.muted }]}>{item.body}</Text>{item.requiresAcknowledgement && !item.acknowledgedAt && <ActionButton label="Подтвердить" icon={Check} variant="quiet" onPress={(event) => { event.stopPropagation(); void acknowledge(item) }} />}</View></Pressable>)}</View>}
	</Screen>
}

const styles = StyleSheet.create({
	pushRow: { flexDirection: 'row', gap: 13, marginBottom: 16 },
	pushCopy: { flex: 1, gap: 5 },
	pushTitle: { fontSize: 16, fontWeight: '600' },
	pushBody: { fontSize: 14, lineHeight: 20 },
	list: { gap: 10 },
	item: { flexDirection: 'row', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 15 },
	unread: { width: 8, height: 8, borderRadius: 8, marginTop: 6 },
	itemCopy: { flex: 1, gap: 6 },
	itemMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
	category: { fontSize: 12, fontWeight: '700' },
	date: { fontSize: 12 },
	itemTitle: { fontSize: 16, fontWeight: '600' },
	itemBody: { fontSize: 14, lineHeight: 20 },
	preferencesHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
	preferencesTitle: { fontSize: 16, fontWeight: '600' },
	preferencesBody: { fontSize: 14, lineHeight: 20, marginTop: 4 },
	preferenceList: { gap: 8 },
	preferenceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
	preferenceLabel: { flex: 1, fontSize: 15 },
})

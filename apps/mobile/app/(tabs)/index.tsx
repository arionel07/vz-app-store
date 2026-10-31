import { useRouter } from 'expo-router'
import { CalendarDays, Camera, ClipboardCheck, Bell, ListChecks, ShieldCheck, UserRound, BookOpen } from 'lucide-react-native'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { getNotificationUnreadCount } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { ActionButton, IconAction, Screen, SectionTitle } from '../../src/components/ui'
import { useAppTheme } from '../../src/theme'

function greeting(): string {
	const hour = new Date().getHours()
	if (hour < 12) return 'Доброе утро'
	if (hour < 18) return 'Добрый день'
	return 'Добрый вечер'
}

export default function HomeScreen() {
	const router = useRouter()
	const { colors } = useAppTheme()
	const { user, requestAuthenticated } = useAuth()
	const [unreadCount, setUnreadCount] = useState(0)
	const greetingText = useMemo(greeting, [])
	const storeCount = user?.assignedStores.length ?? 0
	useEffect(() => { void requestAuthenticated((token) => getNotificationUnreadCount(token)).then((result) => setUnreadCount(result.count)).catch(() => undefined) }, [requestAuthenticated])

	return <Screen>
		<View style={styles.headerRow}><View style={styles.headerCopy}><Text style={[styles.title, { color: colors.text }]}>{greetingText}, {user?.firstName ?? 'коллега'}</Text></View><View style={styles.headerActions}><Pressable accessibilityLabel="Открыть уведомления" onPress={() => router.push('/notifications')} style={[styles.bellAction, { backgroundColor: colors.surfaceRaised }]}><Bell color={colors.text} size={20} />{unreadCount > 0 && <View style={[styles.badge, { backgroundColor: colors.accent }]}><Text style={{ color: colors.onAccent, fontSize: 10, fontWeight: '700' }}>{unreadCount > 9 ? '9+' : unreadCount}</Text></View>}</Pressable><IconAction icon={UserRound} label="Открыть профиль" onPress={() => router.push('/profile')} /></View></View>

		<View style={styles.actions}><ActionButton label="Операции" icon={ClipboardCheck} onPress={() => router.push('/operations')} /><ActionButton label="Открыть задания" icon={ListChecks} variant="secondary" onPress={() => router.push('/tasks')} /><ActionButton label="Открыть тесты" icon={ClipboardCheck} variant="secondary" onPress={() => router.push('/(tabs)/quizzes')} /><ActionButton label="База знаний" icon={BookOpen} variant="secondary" onPress={() => router.push('/knowledge')} /><ActionButton label="Открыть расписание" icon={CalendarDays} variant="secondary" onPress={() => router.push('/schedule')} /><ActionButton label="Добавить фото" icon={Camera} variant="secondary" onPress={() => router.push('/(tabs)/photos')} /></View>

		<SectionTitle>Сегодня</SectionTitle>
		<View style={[styles.statusRow, { backgroundColor: colors.surfaceRaised }]}><View style={[styles.statusIcon, { backgroundColor: colors.accentSoft }]}><ShieldCheck color={colors.accent} size={21} /></View><View style={styles.statusCopy}><Text style={[styles.statusTitle, { color: colors.text }]}>Сессия активна</Text><Text style={[styles.statusBody, { color: colors.muted }]}>{storeCount ? `${storeCount} ${storeCount === 1 ? 'магазин доступен' : 'магазина доступны'} для работы.` : 'Назначенные магазины появятся после настройки профиля.'}</Text></View></View>
	</Screen>
}

const styles = StyleSheet.create({
	headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
	headerCopy: { flex: 1, gap: 7 },
	headerActions: { flexDirection: 'row', gap: 8 },
	bellAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
	badge: { position: 'absolute', right: -1, top: -1, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
	title: { fontSize: 28, fontWeight: '600', letterSpacing: -0.8 },
	actions: { gap: 12, paddingTop: 8 },
	statusRow: { flexDirection: 'row', alignItems: 'center', gap: 13, borderRadius: 20, padding: 16 },
	statusIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
	statusCopy: { flex: 1, gap: 4 },
	statusTitle: { fontSize: 16, fontWeight: '600' },
	statusBody: { fontSize: 14, lineHeight: 20 },
})

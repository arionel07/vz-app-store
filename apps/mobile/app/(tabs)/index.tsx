import { useRouter } from 'expo-router'
import { Camera, ClipboardCheck, ShieldCheck, UserRound } from 'lucide-react-native'
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
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
	const { user } = useAuth()
	const greetingText = useMemo(greeting, [])
	const storeCount = user?.assignedStores.length ?? 0

	return <Screen>
		<View style={styles.headerRow}><View style={styles.headerCopy}><Text style={[styles.title, { color: colors.text }]}>{greetingText}, {user?.firstName ?? 'коллега'}</Text></View><IconAction icon={UserRound} label="Открыть профиль" onPress={() => router.push('/profile')} /></View>

		<View style={styles.actions}><ActionButton label="Открыть тесты" icon={ClipboardCheck} onPress={() => router.push('/(tabs)/quizzes')} /><ActionButton label="Добавить фото" icon={Camera} variant="secondary" onPress={() => router.push('/(tabs)/photos')} /></View>

		<SectionTitle>Сегодня</SectionTitle>
		<View style={[styles.statusRow, { backgroundColor: colors.surfaceRaised }]}><View style={[styles.statusIcon, { backgroundColor: colors.accentSoft }]}><ShieldCheck color={colors.accent} size={21} /></View><View style={styles.statusCopy}><Text style={[styles.statusTitle, { color: colors.text }]}>Сессия активна</Text><Text style={[styles.statusBody, { color: colors.muted }]}>{storeCount ? `${storeCount} ${storeCount === 1 ? 'магазин доступен' : 'магазина доступны'} для работы.` : 'Назначенные магазины появятся после настройки профиля.'}</Text></View></View>
	</Screen>
}

const styles = StyleSheet.create({
	headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
	headerCopy: { flex: 1, gap: 7 },
	title: { fontSize: 28, fontWeight: '600', letterSpacing: -0.8 },
	actions: { gap: 12, paddingTop: 8 },
	statusRow: { flexDirection: 'row', alignItems: 'center', gap: 13, borderRadius: 20, padding: 16 },
	statusIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
	statusCopy: { flex: 1, gap: 4 },
	statusTitle: { fontSize: 16, fontWeight: '600' },
	statusBody: { fontSize: 14, lineHeight: 20 },
})

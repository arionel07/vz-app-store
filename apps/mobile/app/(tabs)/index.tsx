import { useRouter } from 'expo-router'
import { ArrowRight, Camera, ClipboardCheck, UserRound } from 'lucide-react-native'
import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ActionButton, Card, DemoBadge, IconAction, Screen, SectionTitle } from '../../src/components/ui'
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
	const greetingText = useMemo(greeting, [])
	return <Screen>
		<View style={styles.headerRow}><View><Text style={[styles.kicker, { color: colors.muted }]}>VIZAJE STAFF</Text><Text style={[styles.title, { color: colors.text }]}>{greetingText}</Text><Text style={[styles.subtitle, { color: colors.muted }]}>Ваш рабочий день начинается здесь.</Text></View><IconAction icon={UserRound} label="Открыть профиль" onPress={() => router.push('/profile')} /></View>
		<DemoBadge />
		<Card style={styles.welcomeCard}><View style={[styles.welcomeMark, { backgroundColor: colors.accentSoft }]}><ClipboardCheck color={colors.text} size={25} /></View><View style={styles.cardCopy}><Text style={[styles.cardTitle, { color: colors.text }]}>Быстрый доступ</Text><Text style={[styles.cardBody, { color: colors.muted }]}>Переходите к тестам или подготовьте фото для рабочего отчёта.</Text></View></Card>
		<View style={styles.actions}><ActionButton label="Открыть тесты" icon={ClipboardCheck} onPress={() => router.push('/(tabs)/quizzes')} /><ActionButton label="Добавить фото" icon={Camera} variant="secondary" onPress={() => router.push('/(tabs)/photos')} /></View>
		<SectionTitle>Следующий шаг</SectionTitle>
		<Pressable onPress={() => router.push('/activation')} style={({ pressed }) => [styles.activationCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}><View style={styles.activationCopy}><Text style={[styles.cardTitle, { color: colors.text }]}>Активировать приложение</Text><Text style={[styles.cardBody, { color: colors.muted }]}>Демонстрационный экран сканирования QR-кода для первого входа.</Text></View><ArrowRight color={colors.muted} size={20} /></Pressable>
	</Screen>
}

const styles = StyleSheet.create({
	headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
	kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
	title: { marginTop: 7, fontSize: 28, fontWeight: '700', letterSpacing: -0.7 },
	subtitle: { marginTop: 6, fontSize: 15, lineHeight: 21 },
	welcomeCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
	welcomeMark: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
	cardCopy: { flex: 1, gap: 5 },
	cardTitle: { fontSize: 16, fontWeight: '700' },
	cardBody: { fontSize: 14, lineHeight: 20 },
	actions: { gap: 11 },
	activationCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, borderWidth: 1, borderRadius: 18, padding: 18 },
	activationCopy: { flex: 1, gap: 5 },
})

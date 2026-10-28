import { useRouter } from 'expo-router'
import { Camera, QrCode, ShieldCheck } from 'lucide-react-native'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { ActionButton, Card, DemoBadge, Screen, ScreenHeader } from '../src/components/ui'
import { useAppTheme } from '../src/theme'

export default function ActivationScreen() {
	const router = useRouter()
	const { colors } = useAppTheme()
	return <Screen>
		<ScreenHeader title="Активация" subtitle="Подключите мобильное приложение к профилю." back />
		<DemoBadge />
		<View style={styles.hero}><View style={[styles.qrMark, { backgroundColor: colors.accentSoft }]}><QrCode color={colors.text} size={42} strokeWidth={1.7} /></View><Text style={[styles.heroTitle, { color: colors.text }]}>Сканирование QR-кода</Text><Text style={[styles.heroBody, { color: colors.muted }]}>Попросите менеджера создать одноразовый код активации и наведите камеру на QR-код.</Text></View>
		<Card><View style={styles.infoRow}><ShieldCheck color={colors.success} size={21} /><Text style={[styles.infoText, { color: colors.text }]}>Код используется один раз и не сохраняется в приложении.</Text></View></Card>
		<ActionButton label="Сканировать QR-код" icon={Camera} onPress={() => Alert.alert('Сканирование QR-кода', 'Камера будет подключена в следующем milestone.')} /><ActionButton label="Вернуться на главную" variant="quiet" onPress={() => router.replace('/(tabs)')} />
	</Screen>
}

const styles = StyleSheet.create({
	hero: { alignItems: 'center', gap: 12, paddingTop: 18 },
	qrMark: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center', borderRadius: 30 },
	heroTitle: { marginTop: 4, fontSize: 21, fontWeight: '800', textAlign: 'center' },
	heroBody: { maxWidth: 330, fontSize: 15, lineHeight: 22, textAlign: 'center' },
	infoRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
	infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
})

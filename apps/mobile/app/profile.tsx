import { LogOut, Moon, Smartphone, Sun, UserRound } from 'lucide-react-native'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { ActionButton, DemoBadge, IconAction, Screen, ScreenHeader, SectionTitle } from '../src/components/ui'
import { useAppTheme, type ThemeMode } from '../src/theme'

const modes: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [{ value: 'light', label: 'Светлая', icon: Sun }, { value: 'dark', label: 'Тёмная', icon: Moon }, { value: 'system', label: 'Система', icon: Smartphone }]

export default function ProfileScreen() {
	const { colors, mode, setMode } = useAppTheme()
	return <Screen>
		<ScreenHeader title="Профиль" subtitle="Настройки рабочего приложения." back />
		<DemoBadge />
		<View style={styles.identity}><View style={[styles.avatar, { backgroundColor: colors.accent }]}><Text style={[styles.avatarText, { color: colors.onAccent }]}>ДК</Text></View><View style={styles.identityCopy}><Text style={[styles.name, { color: colors.text }]}>Демонстрационный консультант</Text><Text style={[styles.muted, { color: colors.muted }]}>Профиль сотрудника · API не подключён</Text></View></View>
		<View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.infoRow}><UserRound color={colors.muted} size={19} /><View><Text style={[styles.infoLabel, { color: colors.muted }]}>Роль</Text><Text style={[styles.infoValue, { color: colors.text }]}>Консультант</Text></View></View><View style={[styles.divider, { backgroundColor: colors.border }]} /><View style={styles.infoRow}><Smartphone color={colors.muted} size={19} /><View><Text style={[styles.infoLabel, { color: colors.muted }]}>Магазин</Text><Text style={[styles.infoValue, { color: colors.text }]}>Магазин не назначен</Text></View></View></View>
		<SectionTitle>Внешний вид</SectionTitle>
		<View style={[styles.themeGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>{modes.map(({ value, label, icon: Icon }) => { const active = value === mode; return <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => setMode(value)} style={[styles.themeChoice, active && { backgroundColor: colors.accent }]}><Icon size={17} color={active ? colors.onAccent : colors.muted} /><Text style={[styles.themeLabel, { color: active ? colors.onAccent : colors.muted }]}>{label}</Text></Pressable> })}</View>
		<View style={styles.logoutBlock}><ActionButton label="Выйти из аккаунта" icon={LogOut} variant="secondary" onPress={() => Alert.alert('Выход', 'Авторизация будет подключена в следующем milestone.')} /><Text style={[styles.muted, { color: colors.muted }]}>Сессии и выход пока не подключены.</Text></View>
	</Screen>
}

const styles = StyleSheet.create({
	identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
	avatar: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
	avatarText: { fontSize: 20, fontWeight: '800' },
	identityCopy: { flex: 1, gap: 5 },
	name: { fontSize: 17, fontWeight: '700' },
	muted: { fontSize: 13, lineHeight: 18 },
	infoCard: { gap: 15, borderWidth: 1, borderRadius: 18, padding: 18 },
	infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
	infoLabel: { fontSize: 12 },
	infoValue: { marginTop: 3, fontSize: 15, fontWeight: '600' },
	divider: { height: 1 },
	themeGroup: { flexDirection: 'row', gap: 5, borderWidth: 1, borderRadius: 16, padding: 5 },
	themeChoice: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12 },
	themeLabel: { fontSize: 12, fontWeight: '700' },
	logoutBlock: { gap: 9 },
})

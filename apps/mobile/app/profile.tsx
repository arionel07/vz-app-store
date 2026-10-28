import { LogOut, Moon, Smartphone, Sun, UserRound } from 'lucide-react-native'
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../src/auth/auth-context'
import { ActionButton, Screen, ScreenHeader, SectionTitle } from '../src/components/ui'
import { useAppTheme, type ThemeMode } from '../src/theme'

const modes: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [{ value: 'light', label: 'Светлая', icon: Sun }, { value: 'dark', label: 'Тёмная', icon: Moon }, { value: 'system', label: 'Система', icon: Smartphone }]
const roleLabels = { admin: 'Администратор', manager: 'Менеджер', staff: 'Консультант' } as const

export default function ProfileScreen() {
	const { colors, mode, setMode } = useAppTheme()
	const { user, logout } = useAuth()
	const [logoutBusy, setLogoutBusy] = useState(false)

	if (!user) return <Screen><ScreenHeader title="Профиль" subtitle="Проверяем данные аккаунта." back backFallback="/(tabs)" /></Screen>

	const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase()
	const confirmLogout = () => Alert.alert('Выйти из аккаунта?', 'Сессия на этом устройстве будет удалена.', [
		{ text: 'Отмена', style: 'cancel' },
		{ text: 'Выйти', style: 'destructive', onPress: () => void performLogout() },
	])
	const performLogout = async () => {
		setLogoutBusy(true)
		const result = await logout()
		setLogoutBusy(false)
		if (!result.remoteRevoked || !result.localCleared) {
			Alert.alert('Выход выполнен', result.localCleared ? 'Данные удалены с устройства. Удалённую отмену сессии не удалось подтвердить.' : 'Не удалось полностью очистить защищённое хранилище. Повторите попытку.')
		}
	}

	return <Screen>
		<ScreenHeader title="Профиль" subtitle="Данные текущего сотрудника." back backFallback="/(tabs)" />
		<View style={styles.identity}><View style={[styles.avatar, { backgroundColor: colors.accent }]}><Text style={[styles.avatarText, { color: colors.onAccent }]}>{initials}</Text></View><View style={styles.identityCopy}><Text style={[styles.name, { color: colors.text }]}>{user.firstName} {user.lastName}</Text><Text style={[styles.muted, { color: colors.muted }]}>{user.email ?? 'Email не указан'}</Text></View></View>
		<View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.infoRow}><UserRound color={colors.muted} size={19} /><View><Text style={[styles.infoLabel, { color: colors.muted }]}>Роль</Text><Text style={[styles.infoValue, { color: colors.text }]}>{roleLabels[user.role]}</Text></View></View><View style={[styles.divider, { backgroundColor: colors.border }]} /><View style={styles.infoRow}><Smartphone color={colors.muted} size={19} /><View style={styles.storeCopy}><Text style={[styles.infoLabel, { color: colors.muted }]}>Активные магазины</Text>{user.assignedStores.length === 0 ? <Text style={[styles.infoValue, { color: colors.text }]}>Нет активных назначений</Text> : user.assignedStores.map((store) => <Text key={store.id} style={[styles.infoValue, { color: colors.text }]}>{store.name} · {store.code}</Text>)}</View></View><View style={[styles.divider, { backgroundColor: colors.border }]} /><View style={styles.infoRow}><Text style={[styles.statusDot, { color: user.isActive ? colors.success : colors.danger }]}>●</Text><View><Text style={[styles.infoLabel, { color: colors.muted }]}>Статус аккаунта</Text><Text style={[styles.infoValue, { color: colors.text }]}>{user.isActive ? 'Активен' : 'Неактивен'}</Text></View></View></View>
		<SectionTitle>Внешний вид</SectionTitle>
		<View style={[styles.themeGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>{modes.map(({ value, label, icon: Icon }) => { const active = value === mode; return <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => setMode(value)} style={[styles.themeChoice, active && { backgroundColor: colors.accent }]}><Icon size={17} color={active ? colors.onAccent : colors.muted} /><Text style={[styles.themeLabel, { color: active ? colors.onAccent : colors.muted }]}>{label}</Text></Pressable> })}</View>
		<View style={styles.logoutBlock}><ActionButton label={logoutBusy ? 'Выходим…' : 'Выйти из аккаунта'} icon={LogOut} variant="secondary" disabled={logoutBusy} onPress={confirmLogout} /></View>
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
	infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
	storeCopy: { flex: 1, gap: 3 },
	infoLabel: { fontSize: 12 },
	infoValue: { marginTop: 3, fontSize: 15, fontWeight: '600' },
	statusDot: { fontSize: 20, lineHeight: 22 },
	divider: { height: 1 },
	themeGroup: { flexDirection: 'row', gap: 5, borderWidth: 1, borderRadius: 16, padding: 5 },
	themeChoice: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12 },
	themeLabel: { fontSize: 12, fontWeight: '700' },
	logoutBlock: { gap: 9 },
})

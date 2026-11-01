import Constants from 'expo-constants'
import { useFocusEffect, useRouter } from 'expo-router'
import { Bell, ChevronRight, ChevronsUpDown, ClipboardList, Globe2, Info, Leaf, LogOut, ScanFace, ShieldCheck, Store, Sun, UserRound, type LucideIcon } from 'lucide-react-native'
import { useCallback, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View, type AlertButton } from 'react-native'
import { getMyProfile, getNotificationUnreadCount, listAvailableQuizzes, listMyAttempts } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { Screen } from '../../src/components/ui'
import { useAppTheme, type ThemeColors, type ThemeMode } from '../../src/theme'

const roleLabels = { admin: 'Администратор', manager: 'Менеджер', staff: 'Сотрудник' } as const
const modeLabels: Record<ThemeMode, string> = { system: 'Системная', light: 'Светлая', dark: 'Тёмная' }
const themeModes: ThemeMode[] = ['system', 'light', 'dark']

type QuizSummary = { available: number; submitted: number }

export default function ProfileScreen() {
	const router = useRouter()
	const { colors, mode, setMode } = useAppTheme()
	const { user, logout, requestAuthenticated } = useAuth()
	const [profile, setProfile] = useState<Awaited<ReturnType<typeof getMyProfile>> | null>(null)
	const [profileLoading, setProfileLoading] = useState(true)
	const [profileError, setProfileError] = useState(false)
	const [quizSummary, setQuizSummary] = useState<QuizSummary | null>(null)
	const [quizLoading, setQuizLoading] = useState(true)
	const [quizError, setQuizError] = useState(false)
	const [unreadCount, setUnreadCount] = useState(0)
	const [logoutBusy, setLogoutBusy] = useState(false)

	useFocusEffect(useCallback(() => {
		if (!user) return
		let active = true
		setProfileLoading(true)
		setQuizLoading(true)
		setProfileError(false)
		setQuizError(false)

		void Promise.allSettled([
			requestAuthenticated(getMyProfile),
			requestAuthenticated((token) => listAvailableQuizzes(token, { page: 1, pageSize: 1 })),
			requestAuthenticated((token) => listMyAttempts(token, { page: 1, pageSize: 1, status: 'submitted' })),
			requestAuthenticated(getNotificationUnreadCount),
		]).then(([profileResult, quizzesResult, attemptsResult, unreadResult]) => {
			if (!active) return
			if (profileResult.status === 'fulfilled') setProfile(profileResult.value)
			else setProfileError(true)
			if (quizzesResult.status === 'fulfilled' && attemptsResult.status === 'fulfilled') {
				setQuizSummary({ available: quizzesResult.value.pagination.total, submitted: attemptsResult.value.pagination.total })
			} else setQuizError(true)
			if (unreadResult.status === 'fulfilled') setUnreadCount(unreadResult.value.count)
		}).finally(() => {
			if (active) {
				setProfileLoading(false)
				setQuizLoading(false)
			}
		})
		return () => { active = false }
	}, [requestAuthenticated, user]))

	if (!user) return <Screen />

	const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toLocaleUpperCase('ru-RU')
	const availableCount = quizSummary?.available ?? 0
	const completedPercent = availableCount > 0 && quizSummary ? Math.min(100, Math.round(quizSummary.submitted / availableCount * 100)) : 0
	const assignedStores = user.assignedStores

	const openPersonalData = () => {
		const lines = [
			user.email ? `Email: ${user.email}` : null,
			user.phone ? `Телефон: ${user.phone}` : null,
			`Статус: ${user.isActive ? 'Активен' : 'Неактивен'}`,
			profile?.jobTitle ? `Должность: ${profile.jobTitle}` : null,
			profile?.employmentStartedOn ? `Работает с: ${profile.employmentStartedOn}` : null,
		].filter(Boolean)
		Alert.alert('Личные данные', profileLoading ? 'Загружаем дополнительные данные…' : profileError ? 'Дополнительные данные временно недоступны.' : lines.join('\n') || 'Дополнительные данные не указаны.')
	}

	const openSecurityInfo = () => Alert.alert('Безопасность', 'Сессия хранится в защищённом хранилище устройства. Для сброса пароля обратитесь к менеджеру или администратору.')
	const openFaceIdInfo = () => Alert.alert('Face ID', 'Биометрический вход пока не настроен в приложении.')
	const openLanguageInfo = () => Alert.alert('Язык', 'Сейчас в приложении доступен русский язык.')
	const openAbout = () => Alert.alert('О приложении', `Версия ${Constants.expoConfig?.version ?? '—'}`)

	const openThemePicker = () => {
		const buttons: AlertButton[] = themeModes.map((value) => ({
			text: modeLabels[value],
			onPress: () => setMode(value),
			style: value === mode ? 'cancel' : 'default',
		}))
		Alert.alert('Тема оформления', 'Выберите тему', buttons)
	}

	const confirmLogout = () => Alert.alert('Выйти из аккаунта?', 'Сессия на этом устройстве будет удалена.', [
		{ text: 'Отмена', style: 'cancel' },
		{ text: 'Выйти', style: 'destructive', onPress: () => void performLogout() },
	])

	const performLogout = async () => {
		setLogoutBusy(true)
		try {
			const result = await logout()
			if (!result.remoteRevoked || !result.localCleared) {
				Alert.alert('Выход выполнен', result.localCleared ? 'Данные удалены с устройства. Удалённую отмену сессии не удалось подтвердить.' : 'Не удалось полностью очистить защищённое хранилище. Повторите попытку.')
			}
		} finally {
			setLogoutBusy(false)
		}
	}

	return <Screen contentStyle={styles.content}>
		<View style={styles.topBar}>
			<Leaf accessibilityLabel="Vizaje" color={colors.text} size={44} strokeWidth={2.2} />
			<Pressable accessibilityRole="button" accessibilityLabel="Открыть уведомления" hitSlop={4} onPress={() => router.push('/notifications')} style={({ pressed }) => [styles.bellButton, { backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.72 : 1 }]}>
				<Bell color={colors.text} size={22} />
				{unreadCount > 0 && <View style={[styles.badge, { backgroundColor: colors.accent }]}><Text style={[styles.badgeText, { color: colors.onAccent }]}>{unreadCount > 9 ? '9+' : unreadCount}</Text></View>}
			</Pressable>
		</View>

		<Pressable accessibilityRole="button" accessibilityLabel="Открыть личные данные" onPress={openPersonalData} style={({ pressed }) => [styles.identity, { opacity: pressed ? 0.72 : 1 }]}>
			<View style={[styles.avatar, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.avatarText, { color: colors.text }]}>{initials}</Text></View>
			<View style={styles.identityCopy}><Text style={[styles.name, { color: colors.text }]}>{user.firstName} {user.lastName}</Text><Text style={[styles.role, { color: colors.muted }]}>{roleLabels[user.role]}</Text></View>
			<ChevronRight color={colors.muted} size={23} />
		</Pressable>

		<Pressable accessibilityRole="button" accessibilityLabel="Показать назначенные магазины" onPress={() => Alert.alert(assignedStores.length === 1 ? 'Мой магазин' : 'Мои магазины', assignedStores.map((store) => `${store.name} · ${store.code}`).join('\n') || 'Магазины не назначены.')} style={({ pressed }) => [styles.storeCard, { backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.78 : 1 }]}>
			<Store color={colors.text} size={26} strokeWidth={1.8} />
			<View style={styles.storeCopy}>
				<Text style={[styles.storeHeading, { color: colors.text }]}>{assignedStores.length === 1 ? 'Мой магазин' : 'Мои магазины'}</Text>
				{assignedStores.length === 0 ? <Text style={[styles.storeMeta, { color: colors.muted }]}>Магазины не назначены</Text> : assignedStores.map((store) => <View key={store.id} style={styles.storeItem}><Text style={[styles.storeName, { color: colors.muted }]}>{store.name}</Text><Text style={[styles.storeMeta, { color: colors.muted }]}>Код {store.code}</Text></View>)}
			</View>
			<ChevronRight color={colors.muted} size={23} />
		</Pressable>

		<Pressable accessibilityRole="button" accessibilityLabel="Открыть тесты" onPress={() => router.push('/(tabs)/quizzes')} style={({ pressed }) => [styles.quizCard, { backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.78 : 1 }]}>
			<View style={styles.quizHeadingRow}><ClipboardList color={colors.text} size={24} /><Text style={[styles.quizHeading, { color: colors.text }]}>Тесты</Text><View style={styles.quizTotal}><Text style={[styles.quizTotalText, { color: colors.muted }]}>{quizLoading ? '…' : quizError ? '—' : `${availableCount} всего`}</Text><ChevronRight color={colors.muted} size={21} /></View></View>
			<View style={styles.quizStatsRow}>
				{quizLoading ? <ActivityIndicator size="small" color={colors.muted} /> : <><Text style={[styles.quizCount, { color: colors.text }]}>{quizError ? '—' : quizSummary?.submitted ?? 0}</Text><Text style={[styles.quizPassed, { color: colors.muted }]}>{quizError ? 'Статистика недоступна' : 'завершено'}</Text><Text style={[styles.quizPercent, { color: colors.muted }]}>{quizError ? '' : `${completedPercent}%`}</Text></>}
			</View>
			<View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: completedPercent }} style={[styles.progressTrack, { backgroundColor: colors.border }]}><View style={[styles.progressFill, { backgroundColor: colors.text, width: `${completedPercent}%` }]} /></View>
		</Pressable>

		<SettingsGroup colors={colors}>
			<SettingRow icon={UserRound} label="Личные данные" onPress={openPersonalData} colors={colors} />
			<SettingRow icon={ShieldCheck} label="Безопасность" onPress={openSecurityInfo} colors={colors} />
			<SettingRow icon={ScanFace} label="Face ID" onPress={openFaceIdInfo} trailing={<Switch value={false} disabled trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.surface} />} colors={colors} />
			<SettingRow icon={Bell} label="Уведомления" onPress={() => router.push('/notifications')} colors={colors} last />
		</SettingsGroup>

		<SettingsGroup colors={colors}>
			<SettingRow icon={Sun} label="Тема оформления" value={modeLabels[mode]} onPress={openThemePicker} colors={colors} trailing={<ChevronsUpDown color={colors.muted} size={19} />} />
			<SettingRow icon={Globe2} label="Язык" value="Русский" onPress={openLanguageInfo} colors={colors} />
			<SettingRow icon={Info} label="О приложении" onPress={openAbout} colors={colors} last />
		</SettingsGroup>

		<Pressable accessibilityRole="button" onPress={confirmLogout} disabled={logoutBusy} style={({ pressed }) => [styles.logout, { backgroundColor: colors.surfaceRaised, opacity: logoutBusy ? 0.5 : pressed ? 0.72 : 1 }]}>
			{logoutBusy ? <ActivityIndicator color={colors.danger} /> : <LogOut color={colors.danger} size={24} />}
			<Text style={[styles.logoutText, { color: colors.danger }]}>{logoutBusy ? 'Выходим…' : 'Выйти из аккаунта'}</Text>
			<ChevronRight color={colors.muted} size={23} />
		</Pressable>
	</Screen>
}

function SettingsGroup({ children, colors }: { children: ReactNode; colors: ThemeColors }) {
	return <View style={[styles.settingsGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
}

function SettingRow({ icon: Icon, label, value, trailing, onPress, colors, last = false }: { icon: LucideIcon; label: string; value?: string; trailing?: ReactNode; onPress: () => void; colors: ThemeColors; last?: boolean }) {
	return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.settingRow, { opacity: pressed ? 0.72 : 1 }]}>
		<Icon color={colors.text} size={23} strokeWidth={1.8} />
		<Text style={[styles.settingLabel, { color: colors.text }]}>{label}</Text>
		{value && <Text style={[styles.settingValue, { color: colors.muted }]}>{value}</Text>}
		{trailing ?? <ChevronRight color={colors.muted} size={22} />}
		{!last && <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />}
	</Pressable>
}

const styles = StyleSheet.create({
	content: { gap: 10, paddingHorizontal: 24, paddingBottom: 12 },
	topBar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3 },
	bellButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
	badge: { position: 'absolute', top: -1, right: -1, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 9, paddingHorizontal: 4 },
	badgeText: { fontSize: 10, fontWeight: '700' },
	identity: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 2 },
	avatar: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: 30 },
	avatarText: { fontSize: 20, fontWeight: '400', letterSpacing: 0.2 },
	identityCopy: { flex: 1, gap: 5 },
	name: { fontSize: 22, lineHeight: 27, fontWeight: '700', letterSpacing: -0.5 },
	role: { fontSize: 16, lineHeight: 21 },
	storeCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 20, borderRadius: 22, paddingHorizontal: 20, paddingVertical: 12 },
	storeCopy: { flex: 1, gap: 3 },
	storeHeading: { fontSize: 16, fontWeight: '600' },
	storeItem: { gap: 1, marginTop: 2 },
	storeName: { fontSize: 16, lineHeight: 21 },
	storeMeta: { fontSize: 14, lineHeight: 20 },
	quizCard: { minHeight: 108, justifyContent: 'center', gap: 8, borderRadius: 22, paddingHorizontal: 20, paddingVertical: 12 },
	quizHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
	quizHeading: { flex: 1, fontSize: 17, fontWeight: '600' },
	quizTotal: { flexDirection: 'row', alignItems: 'center', gap: 5 },
	quizTotalText: { fontSize: 14 },
	quizStatsRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10 },
	quizCount: { fontSize: 29, lineHeight: 34, fontWeight: '700' },
	quizPassed: { flex: 1, fontSize: 15 },
	quizPercent: { fontSize: 15 },
	progressTrack: { height: 8, overflow: 'hidden', borderRadius: 999 },
	progressFill: { height: '100%', borderRadius: 999 },
	settingsGroup: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, paddingHorizontal: 16 },
	settingRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 16, position: 'relative' },
	settingLabel: { flex: 1, fontSize: 16 },
	settingValue: { fontSize: 14 },
	rowDivider: { position: 'absolute', right: 0, bottom: 0, left: 48, height: StyleSheet.hairlineWidth },
	logout: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 22, paddingHorizontal: 20 },
	logoutText: { flex: 1, fontSize: 16, fontWeight: '500' },
})

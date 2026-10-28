import { useRouter } from 'expo-router'
import { ChevronLeft, type LucideIcon } from 'lucide-react-native'
import { useMemo, type PropsWithChildren, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppTheme } from '../theme'

type ScreenProps = PropsWithChildren<{ scroll?: boolean; contentStyle?: StyleProp<ViewStyle> }>

export function Screen({ children, scroll = true, contentStyle }: ScreenProps) {
	const { colors } = useAppTheme()
	const insets = useSafeAreaInsets()
	const screenContentStyle = [styles.screenContent, { paddingBottom: Math.max(insets.bottom, 20) }, contentStyle]
	return scroll ? <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={screenContentStyle} showsVerticalScrollIndicator={false}>{children}</ScrollView> : <View style={[styles.screen, { backgroundColor: colors.background }]}><View style={screenContentStyle}>{children}</View></View>
}

export function ScreenHeader({ title, subtitle, back = false, action }: { title: string; subtitle?: string; back?: boolean; action?: ReactNode }) {
	const router = useRouter()
	const { colors } = useAppTheme()
	return <View style={styles.header}>
		<View style={styles.headerTitleRow}>{back && <Pressable accessibilityLabel="Назад" hitSlop={10} onPress={() => router.back()} style={styles.backButton}><ChevronLeft size={24} color={colors.text} /></Pressable>}<View style={styles.headerCopy}><Text style={[styles.eyebrow, { color: colors.muted }]}>VIZAJE STAFF</Text><Text style={[styles.heading, { color: colors.text }]}>{title}</Text>{subtitle && <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text>}</View></View>{action}</View>
}

export function SectionTitle({ children, right }: PropsWithChildren<{ right?: ReactNode }>) {
	const { colors } = useAppTheme()
	return <View style={styles.sectionTitle}><Text style={[styles.sectionHeading, { color: colors.text }]}>{children}</Text>{right}</View>
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
	const { colors } = useAppTheme()
	return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>
}

type ActionButtonProps = Omit<PressableProps, 'style'> & { label: string; icon?: LucideIcon; variant?: 'primary' | 'secondary' | 'quiet'; style?: StyleProp<ViewStyle> }
export function ActionButton({ label, icon: Icon, variant = 'primary', style, ...props }: ActionButtonProps) {
	const { colors } = useAppTheme()
	const palette = variant === 'primary' ? { backgroundColor: colors.accent, foreground: colors.onAccent, borderColor: colors.accent } : variant === 'secondary' ? { backgroundColor: colors.surface, foreground: colors.text, borderColor: colors.border } : { backgroundColor: 'transparent', foreground: colors.muted, borderColor: 'transparent' }
	return <Pressable {...props} style={({ pressed }) => [styles.actionButton, { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor, opacity: pressed ? 0.78 : 1 }, style]}><>{Icon && <Icon size={19} color={palette.foreground} strokeWidth={2} />}<Text style={[styles.actionButtonText, { color: palette.foreground }]}>{label}</Text></></Pressable>
}

export function IconAction({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
	const { colors } = useAppTheme()
	return <Pressable accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.iconAction, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}><Icon color={colors.text} size={20} /></Pressable>
}

export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
	const { colors } = useAppTheme()
	return <View style={[styles.emptyState, { borderColor: colors.border, backgroundColor: colors.surface }]}><Icon color={colors.muted} size={27} strokeWidth={1.8} /><Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.emptyBody, { color: colors.muted }]}>{body}</Text></View>
}

export function DemoState({ title, body, loading = false }: { title: string; body: string; loading?: boolean }) {
	const { colors } = useAppTheme()
	return <View style={[styles.demoState, { backgroundColor: colors.surfaceRaised }]}><View style={[styles.demoStateMark, { backgroundColor: loading ? colors.accent : colors.border }]} /><View style={styles.demoStateCopy}><Text style={[styles.demoStateTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.demoStateBody, { color: colors.muted }]}>{body}</Text></View></View>
}

export function SessionStatusScreen({ title, body, actionLabel, onAction, loading = false }: { title: string; body: string; actionLabel?: string; onAction?: () => void; loading?: boolean }) {
	const { colors } = useAppTheme()
	return <View style={[styles.sessionStatus, { backgroundColor: colors.background }]}>
		{loading ? <ActivityIndicator color={colors.text} size="small" /> : <View style={[styles.sessionStatusMark, { backgroundColor: colors.accentSoft }]} />}
		<Text style={[styles.sessionStatusTitle, { color: colors.text }]}>{title}</Text>
		<Text style={[styles.sessionStatusBody, { color: colors.muted }]}>{body}</Text>
		{actionLabel && onAction && <ActionButton label={actionLabel} variant="secondary" onPress={onAction} style={styles.sessionStatusAction} />}
	</View>
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	screenContent: { paddingHorizontal: 20, paddingTop: 18, gap: 24 },
	header: { minHeight: 72, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
	headerTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
	headerCopy: { flex: 1 },
	backButton: { marginTop: 17, padding: 2 },
	eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
	heading: { marginTop: 5, fontSize: 28, fontWeight: '700', letterSpacing: -0.7 },
	subtitle: { marginTop: 6, fontSize: 15, lineHeight: 21 },
	sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
	sectionHeading: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
	card: { borderWidth: 1, borderRadius: 18, padding: 18 },
	actionButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderWidth: 1, borderRadius: 14, paddingHorizontal: 18 },
	actionButtonText: { fontSize: 16, fontWeight: '700' },
	iconAction: { width: 45, height: 45, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 14 },
	emptyState: { alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 18, paddingHorizontal: 22, paddingVertical: 30 },
	emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
	emptyBody: { maxWidth: 300, fontSize: 14, lineHeight: 20, textAlign: 'center' },
	demoState: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14 },
	demoStateMark: { width: 10, height: 10, borderRadius: 10 },
	demoStateCopy: { flex: 1, gap: 3 },
	demoStateTitle: { fontSize: 14, fontWeight: '700' },
	demoStateBody: { fontSize: 13, lineHeight: 18 },
	sessionStatus: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 },
	sessionStatusMark: { width: 40, height: 40, borderRadius: 14 },
	sessionStatusTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
	sessionStatusBody: { maxWidth: 330, fontSize: 15, lineHeight: 22, textAlign: 'center' },
	sessionStatusAction: { width: '100%', marginTop: 4 },
})

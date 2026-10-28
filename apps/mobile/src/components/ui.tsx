import { useRouter, type Href } from 'expo-router'
import { ChevronLeft, type LucideIcon } from 'lucide-react-native'
import { useMemo, type PropsWithChildren, type ReactNode } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppTheme } from '../theme'
import { goBackOrReplace } from '../navigation/safe-navigation'

type ScreenProps = PropsWithChildren<{ scroll?: boolean; keyboardAware?: boolean; contentStyle?: StyleProp<ViewStyle>; refreshing?: boolean; onRefresh?: () => void }>

export function Screen({ children, scroll = true, keyboardAware = false, contentStyle, refreshing, onRefresh }: ScreenProps) {
	const { colors } = useAppTheme()
	const insets = useSafeAreaInsets()
	const screenContentStyle = [styles.screenContent, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }, !scroll && styles.screenContentFill, contentStyle]
	const refreshControl = refreshing !== undefined && onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} /> : undefined
	const content = scroll ? <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={screenContentStyle} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" refreshControl={refreshControl}>{children}</ScrollView> : <View style={styles.screenContentWrap}><View style={screenContentStyle}>{children}</View></View>
	const screen = <View style={[styles.screen, { backgroundColor: colors.background }]}>{content}</View>
	return keyboardAware ? <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{screen}</KeyboardAvoidingView> : screen
}

export function ScreenHeader({ title, back = false, backFallback, action }: { title: string; back?: boolean; backFallback?: Href; action?: ReactNode }) {
	const router = useRouter()
	const { colors } = useAppTheme()
	const canGoBack = router.canGoBack()
	const fallback = backFallback ?? '/(tabs)'
	return <View style={styles.header}>
		<View style={styles.headerTitleRow}>{back && <Pressable accessibilityLabel="Назад" hitSlop={10} disabled={!canGoBack && !backFallback} onPress={() => goBackOrReplace(router, fallback)} style={[styles.backButton, !canGoBack && !backFallback && styles.backButtonDisabled]}><ChevronLeft size={24} color={colors.text} /></Pressable>}<View style={styles.headerCopy}><Text style={[styles.heading, { color: colors.text }]}>{title}</Text></View></View>{action}
	</View>
}

export function SectionTitle({ children, right }: PropsWithChildren<{ right?: ReactNode }>) {
	const { colors } = useAppTheme()
	return <View style={styles.sectionTitle}><Text style={[styles.sectionHeading, { color: colors.text }]}>{children}</Text>{right}</View>
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
	const { colors } = useAppTheme()
	return <View style={[styles.card, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }, style]}>{children}</View>
}

type ActionButtonProps = Omit<PressableProps, 'style'> & { label: string; icon?: LucideIcon; variant?: 'primary' | 'secondary' | 'quiet'; style?: StyleProp<ViewStyle> }
export function ActionButton({ label, icon: Icon, variant = 'primary', style, ...props }: ActionButtonProps) {
	const { colors } = useAppTheme()
	const palette = variant === 'primary' ? { backgroundColor: colors.accent, foreground: colors.onAccent, borderColor: colors.accent } : variant === 'secondary' ? { backgroundColor: colors.surface, foreground: colors.text, borderColor: colors.border } : { backgroundColor: 'transparent', foreground: colors.muted, borderColor: 'transparent' }
	return <Pressable {...props} style={({ pressed }) => [styles.actionButton, { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor, opacity: props.disabled ? 0.45 : pressed ? 0.72 : 1 }, style]}><>{Icon && <Icon size={19} color={palette.foreground} strokeWidth={2} />}<Text style={[styles.actionButtonText, { color: palette.foreground }]}>{label}</Text></></Pressable>
}

export function IconAction({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
	const { colors } = useAppTheme()
	return <Pressable accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.iconAction, { backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.7 : 1 }]}><Icon color={colors.text} size={20} /></Pressable>
}

export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
	const { colors } = useAppTheme()
	return <View style={[styles.emptyState, { backgroundColor: colors.surfaceRaised }]}><Icon color={colors.muted} size={25} strokeWidth={1.8} /><Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.emptyBody, { color: colors.muted }]}>{body}</Text></View>
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

export function ProgressBar({ value }: { value: number }) {
	const { colors } = useAppTheme()
	return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: value }} style={[styles.progressTrack, { backgroundColor: colors.surfaceRaised }]}><View style={[styles.progressValue, { backgroundColor: colors.accent, width: `${Math.max(0, Math.min(100, value))}%` }]} /></View>
}

export function InlineMessage({ title, body, actionLabel, onAction }: { title: string; body: string; actionLabel?: string; onAction?: () => void }) {
	const { colors } = useAppTheme()
	return <View style={[styles.inlineMessage, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.inlineMessageTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.inlineMessageBody, { color: colors.muted }]}>{body}</Text>{actionLabel && onAction && <ActionButton label={actionLabel} variant="secondary" onPress={onAction} />}</View>
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	screenContentWrap: { flex: 1 },
	screenContent: { paddingHorizontal: 20, gap: 24 },
	screenContentFill: { flex: 1 },
	header: { minHeight: 64, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
	headerTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
	headerCopy: { flex: 1 },
	backButton: { marginTop: 8, padding: 2 },
	backButtonDisabled: { opacity: 0.35 },
	heading: { fontSize: 28, fontWeight: '600', letterSpacing: -0.8 },
	sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
	sectionHeading: { fontSize: 21, fontWeight: '600', letterSpacing: -0.25 },
	card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 18 },
	actionButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderWidth: 1, borderRadius: 999, paddingHorizontal: 20 },
	actionButtonText: { fontSize: 16, fontWeight: '600' },
	iconAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
	emptyState: { alignItems: 'center', gap: 9, borderRadius: 20, paddingHorizontal: 22, paddingVertical: 34 },
	emptyTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
	emptyBody: { maxWidth: 300, fontSize: 14, lineHeight: 20, textAlign: 'center' },
	demoState: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14 },
	demoStateMark: { width: 10, height: 10, borderRadius: 10 },
	demoStateCopy: { flex: 1, gap: 3 },
	demoStateTitle: { fontSize: 14, fontWeight: '700' },
	demoStateBody: { fontSize: 13, lineHeight: 18 },
	sessionStatus: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 },
	sessionStatusMark: { width: 40, height: 40, borderRadius: 20 },
	sessionStatusTitle: { fontSize: 21, fontWeight: '600', textAlign: 'center' },
	sessionStatusBody: { maxWidth: 330, fontSize: 15, lineHeight: 22, textAlign: 'center' },
	sessionStatusAction: { width: '100%', marginTop: 4 },
	progressTrack: { height: 8, overflow: 'hidden', borderRadius: 999 },
	progressValue: { height: '100%', borderRadius: 999 },
	inlineMessage: { gap: 8, borderRadius: 18, padding: 16 },
	inlineMessageTitle: { fontSize: 16, fontWeight: '600' },
	inlineMessageBody: { fontSize: 14, lineHeight: 20 },
})

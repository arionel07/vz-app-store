import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { useURL } from 'expo-linking'
import { Camera, ChevronLeft, Eye, EyeOff, Leaf, LockKeyhole, Mail, ScanQrCode } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { createActivationLinkGate, parseActivationPayload, type ActivationPayload } from '../src/auth/activation-payload'
import { activationError } from '../src/auth/activation-errors'
import { resolveActivationUrl } from '../src/auth/activation-link'
import { useAuth } from '../src/auth/auth-context'
import { mobileLoginErrorMessage } from '../src/auth/login-errors'
import { ActionButton, Card, Screen } from '../src/components/ui'
import { useAppTheme, type ThemeColors } from '../src/theme'

export default function ActivationScreen() {
	const { colors } = useAppTheme()
	const { loginMobile, loginSubmissionStatus, redeemActivation } = useAuth()
	const [permission, requestPermission] = useCameraPermissions()
	const [scanning, setScanning] = useState(false)
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const [showLogin, setShowLogin] = useState(true)
	const [loginEmail, setLoginEmail] = useState('')
	const [loginPassword, setLoginPassword] = useState('')
	const [showPassword, setShowPassword] = useState(false)
	const [loginMessage, setLoginMessage] = useState<string | null>(null)
	const [pendingLink, setPendingLink] = useState<ActivationPayload | null>(null)
	const passwordInputRef = useRef<TextInputInstance>(null)
	const scanLocked = useRef(false)
	const busyRef = useRef(false)
	const lastUrl = useRef<string | null>(null)
	const linkGate = useRef(createActivationLinkGate())
	const url = useURL()
	const activationLinkBaseUrl = process.env.EXPO_PUBLIC_ACTIVATION_LINK_BASE_URL
	const loginSubmitting = loginSubmissionStatus === 'submitting'

	const redeemPayload = useCallback(async (payload: ActivationPayload) => {
		if (scanLocked.current || busyRef.current) return
		scanLocked.current = true
		busyRef.current = true
		setScanning(false)
		setMessage(null)
		setBusy(true)
		try {
			await redeemActivation(payload.secret)
		} catch (error) {
			setMessage(activationError(error))
			scanLocked.current = false
		} finally {
			busyRef.current = false
			setBusy(false)
		}
	}, [redeemActivation])

	useEffect(() => {
		if (!url || url === lastUrl.current) return
		lastUrl.current = url
		const resolution = resolveActivationUrl(url, activationLinkBaseUrl)
		if (resolution.kind === 'unrelated') return
		if (resolution.kind === 'malformed') {
			setPendingLink(null)
			setShowLogin(false)
			setMessage('Ссылка активации повреждена или не поддерживается. Попросите новый QR-код или ссылку.')
			return
		}
		const payload = resolution.payload
		if (!linkGate.current(payload)) return
		setShowLogin(false)
		setMessage(null)
		setPendingLink(payload)
	}, [activationLinkBaseUrl, url])

	const confirmLinkActivation = () => {
		if (!pendingLink || busyRef.current) return
		const payload = pendingLink
		setPendingLink(null)
		void redeemPayload(payload)
	}

	const cancelLinkActivation = () => {
		setPendingLink(null)
		setMessage('Активация отменена.')
	}

	const submitLogin = async () => {
		if (busyRef.current || loginSubmitting) return
		setMessage(null)
		setLoginMessage(null)
		const email = loginEmail.trim()
		if (!/^\S+@\S+\.\S+$/.test(email) || !loginPassword) {
			setLoginMessage('Введите корректный email и пароль.')
			return
		}
		busyRef.current = true
		setBusy(true)
		try {
			await loginMobile(email, loginPassword)
		} catch (error) {
			setLoginMessage(mobileLoginErrorMessage(error))
		} finally {
			busyRef.current = false
			setBusy(false)
		}
	}

	const startScanning = async () => {
		setMessage(null)
		if (Platform.OS === 'web') {
			setMessage('Сканирование камеры доступно только в нативном приложении.')
			return
		}
		const result = permission?.granted ? permission : await requestPermission()
		if (!result.granted) {
			setMessage('Для активации разрешите доступ к камере в настройках устройства.')
			return
		}
		scanLocked.current = false
		setScanning(true)
	}

	const showPasswordResetHelp = () => Alert.alert(
		'Сброс пароля',
		'Попросите менеджера или администратора назначить новый пароль.',
	)

	const openQrLogin = () => {
		setMessage(null)
		setLoginMessage(null)
		setShowLogin(false)
	}

	const openEmailLogin = () => {
		setMessage(null)
		setLoginMessage(null)
		setShowLogin(true)
	}

	const onBarcodeScanned = (result: BarcodeScanningResult) => {
		const payload = parseActivationPayload(result.data)
		if (!payload || payload.source !== 'custom') {
			setMessage('QR-код не является кодом активации Vizaje.')
			scanLocked.current = false
			return
		}
		void redeemPayload(payload)
	}

	if (scanning) return <ScannerView colors={colors} onClose={() => setScanning(false)} onBarcodeScanned={scanLocked.current ? undefined : onBarcodeScanned} />

	return <Screen keyboardAware={showLogin && !pendingLink} contentStyle={styles.content}>
		{!pendingLink && <View style={styles.topBar}>
			{showLogin ? <Pressable
				accessibilityRole="button"
				accessibilityLabel="Назад к входу по QR-коду"
				disabled={busy || loginSubmitting}
				onPress={openQrLogin}
				style={({ pressed }) => [styles.backButton, { backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.72 : 1 }]}
			><ChevronLeft color={colors.text} size={25} strokeWidth={2} /></Pressable> : <View style={styles.backPlaceholder} />}
		</View>}

		<View style={styles.brandBlock}>
			<Leaf accessibilityLabel="Vizaje" color={colors.text} size={48} strokeWidth={2.2} />
			<Text style={[styles.title, { color: colors.text }]}>{pendingLink ? 'Подтвердите вход' : showLogin ? 'Войти' : 'Войти по QR'}</Text>
		</View>

		{pendingLink && <Card style={styles.linkConfirmation}>
			<Text style={[styles.confirmationTitle, { color: colors.text }]}>Подтвердите активацию</Text>
			<ActionButton label="Активировать приложение" onPress={confirmLinkActivation} disabled={busy} />
			<ActionButton label="Отмена" variant="quiet" onPress={cancelLinkActivation} disabled={busy} />
		</Card>}

		{!pendingLink && showLogin && <View style={styles.loginPanel}>
			<View style={styles.fields}>
				<View style={[styles.inputField, { backgroundColor: colors.surfaceRaised }]}>
					<Mail color={colors.muted} size={23} strokeWidth={1.9} />
					<TextInput
						accessibilityLabel="Электронная почта"
						style={[styles.input, { color: colors.text }]}
						value={loginEmail}
						onChangeText={setLoginEmail}
						placeholder="Email"
						placeholderTextColor={colors.muted}
						autoCapitalize="none"
						autoCorrect={false}
						autoComplete="email"
						keyboardType="email-address"
						textContentType="emailAddress"
						editable={!busy && !loginSubmitting}
						returnKeyType="next"
						onSubmitEditing={() => passwordInputRef.current?.focus()}
					/>
				</View>
				<View style={[styles.inputField, { backgroundColor: colors.surfaceRaised }]}>
					<LockKeyhole color={colors.muted} size={23} strokeWidth={1.9} />
					<TextInput
						ref={passwordInputRef}
						accessibilityLabel="Пароль"
						style={[styles.input, styles.passwordInput, { color: colors.text }]}
						value={loginPassword}
						onChangeText={setLoginPassword}
						placeholder="Пароль"
						placeholderTextColor={colors.muted}
						secureTextEntry={!showPassword}
						autoCapitalize="none"
						autoCorrect={false}
						autoComplete="current-password"
						textContentType="password"
						editable={!busy && !loginSubmitting}
						returnKeyType="done"
						onSubmitEditing={() => void submitLogin()}
					/>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
						accessibilityState={{ selected: showPassword }}
						onPress={() => setShowPassword((value) => !value)}
						disabled={busy || loginSubmitting}
						style={styles.visibilityButton}
					>
						{showPassword ? <EyeOff color={colors.muted} size={23} /> : <Eye color={colors.muted} size={23} />}
					</Pressable>
				</View>
			</View>

			{loginMessage && <Text accessibilityRole="alert" style={[styles.loginError, { color: colors.danger }]}>{loginMessage}</Text>}
			<ActionButton
				label={busy || loginSubmitting ? 'Выполняем вход…' : 'Войти'}
				disabled={busy || loginSubmitting}
				onPress={() => void submitLogin()}
				style={styles.primaryButton}
			/>
			<Pressable
				accessibilityRole="button"
				onPress={showPasswordResetHelp}
				style={styles.forgotButton}
			>
				<Text style={[styles.forgotText, { color: colors.accent }]}>Забыли пароль?</Text>
			</Pressable>
		</View>}

		{!pendingLink && !showLogin && <View style={styles.qrStage}>
			<View style={[styles.qrTarget, { backgroundColor: colors.surfaceRaised }]}>
				<ScanQrCode color={colors.text} size={132} strokeWidth={1.65} />
			</View>
			<ActionButton
				label={busy ? 'Подготавливаем камеру…' : 'Сканировать QR'}
				icon={Camera}
				disabled={busy}
				onPress={() => void startScanning()}
				style={[styles.primaryButton, styles.qrPrimaryButton]}
			/>
		</View>}

		{message && <View accessibilityRole="alert" style={[styles.message, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.messageText, { color: colors.text }]}>{message}</Text>{message.includes('настройках') && <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}><Text style={[styles.settingsLink, { color: colors.accent }]}>Открыть настройки</Text></Pressable>}</View>}
		{busy && !loginSubmitting && <View style={styles.busy}><ActivityIndicator color={colors.accent} /><Text style={[styles.busyText, { color: colors.muted }]}>Проверяем код активации…</Text></View>}

		{!pendingLink && <View style={styles.footer}>
			<View style={styles.divider}>
				<View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
				<Text style={[styles.dividerText, { color: colors.muted }]}>ИЛИ</Text>
				<View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
			</View>
			<ActionButton
				label={showLogin ? 'Войти по QR-коду' : 'Войти через email'}
				icon={showLogin ? ScanQrCode : Mail}
				variant="secondary"
				disabled={busy || loginSubmitting}
				onPress={showLogin ? openQrLogin : openEmailLogin}
				style={[styles.secondaryButton, { backgroundColor: colors.surfaceRaised, borderColor: colors.surfaceRaised }]}
			/>
		</View>}
	</Screen>
}

function ScannerView({ colors, onClose, onBarcodeScanned }: { colors: ThemeColors; onClose: () => void; onBarcodeScanned?: (result: BarcodeScanningResult) => void }) {
	const insets = useSafeAreaInsets()
	return <View style={styles.scanner}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onBarcodeScanned}><View style={styles.scannerOverlay} pointerEvents="box-none"><View style={[styles.scannerTop, { paddingTop: insets.top + 12 }]}><Pressable accessibilityRole="button" accessibilityLabel="Закрыть сканер" onPress={onClose} style={[styles.scannerControl, { backgroundColor: colors.surface }]}><ChevronLeft color={colors.text} size={24} /></Pressable><View style={styles.scannerControlPlaceholder} /></View><View style={styles.scanCenter}><View style={[styles.scanFrame, { borderColor: colors.accent }]} /></View><View style={[styles.scannerBottom, { paddingBottom: insets.bottom + 20 }]}><Text style={styles.scannerHint}>Наведите камеру на QR-код</Text></View></View></CameraView></View>
}

const styles = StyleSheet.create({
	content: { flexGrow: 1, gap: 0, justifyContent: 'space-between' },
	topBar: { height: 48, flexDirection: 'row', alignItems: 'center' },
	backButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
	backPlaceholder: { width: 48, height: 48 },
	brandBlock: { alignItems: 'center', gap: 34, paddingTop: 8, paddingBottom: 24 },
	title: { fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -1.2, textAlign: 'center' },
	loginPanel: { gap: 0 },
	fields: { gap: 14 },
	inputField: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 20, borderRadius: 23, paddingLeft: 21, paddingRight: 13 },
	input: { flex: 1, minWidth: 0, minHeight: 58, paddingVertical: 0, fontSize: 17 },
	passwordInput: { paddingRight: 0 },
	visibilityButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
	primaryButton: { minHeight: 56, marginTop: 30 },
	forgotButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
	forgotText: { fontSize: 16, fontWeight: '500' },
	qrStage: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 8 },
	qrTarget: { width: '66%', maxWidth: 270, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
	qrPrimaryButton: { alignSelf: 'stretch' },
	footer: { paddingTop: 20, gap: 20 },
	divider: { minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12 },
	dividerLine: { height: StyleSheet.hairlineWidth, flex: 1 },
	dividerText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
	secondaryButton: { minHeight: 62 },
	loginError: { fontSize: 14, lineHeight: 20 },
	message: { gap: 8, borderRadius: 16, padding: 14 },
	messageText: { fontSize: 14, lineHeight: 20 },
	settingsLink: { fontSize: 14, fontWeight: '600' },
	linkConfirmation: { gap: 14 },
	confirmationTitle: { fontSize: 18, fontWeight: '600' },
	busy: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
	busyText: { fontSize: 15 },
	scanner: { flex: 1, backgroundColor: '#000000' },
	scannerOverlay: { flex: 1, justifyContent: 'space-between' },
	scannerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
	scannerControl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
	scannerControlPlaceholder: { width: 44, height: 44 },
	scanCenter: { alignItems: 'center', justifyContent: 'center' },
	scanFrame: { width: 238, height: 238, borderWidth: 3, borderRadius: 28 },
	scannerBottom: { alignItems: 'center', paddingHorizontal: 20 },
	scannerHint: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
})

import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { useURL } from 'expo-linking'
import { Camera, ChevronLeft, Eye, EyeOff, LogIn, Mail, QrCode } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ApiError, isNetworkError } from '../src/api/client'
import { createActivationLinkGate, parseActivationPayload, type ActivationPayload } from '../src/auth/activation-payload'
import { useAuth } from '../src/auth/auth-context'
import { mobileLoginErrorMessage } from '../src/auth/login-errors'
import { ActionButton, Card, Screen } from '../src/components/ui'
import { useAppTheme, type ThemeColors } from '../src/theme'

function activationError(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === 'INVALID_ACTIVATION' || error.status === 401) return 'Код недействителен, уже использован или срок его действия истёк.'
		if (error.code === 'RATE_LIMITED' || error.status === 429) return 'Слишком много попыток. Получите новый код и повторите позже.'
		if (isNetworkError(error)) return 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.'
	}
	return 'Не удалось активировать приложение. Повторите попытку или запросите новый QR-код.'
}

export default function ActivationScreen() {
	const { colors } = useAppTheme()
	const { loginMobile, loginSubmissionStatus, redeemActivation } = useAuth()
	const [permission, requestPermission] = useCameraPermissions()
	const [scanning, setScanning] = useState(false)
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const [showLogin, setShowLogin] = useState(false)
	const [loginEmail, setLoginEmail] = useState('')
	const [loginPassword, setLoginPassword] = useState('')
	const [showPassword, setShowPassword] = useState(false)
	const [loginMessage, setLoginMessage] = useState<string | null>(null)
	const [pendingLink, setPendingLink] = useState<ActivationPayload | null>(null)
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
		const payload = parseActivationPayload(url, activationLinkBaseUrl)
		if (!payload) {
			setMessage('Ссылка активации недействительна или больше не поддерживается.')
			return
		}
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

	return <Screen keyboardAware={showLogin} contentStyle={styles.content}>
		<View style={styles.brandBlock}><Text style={[styles.brand, { color: colors.muted }]}>VIZAJE STAFF</Text><Text style={[styles.title, { color: colors.text }]}>{showLogin ? 'Вход' : 'Добро пожаловать'}</Text><Text style={[styles.subtitle, { color: colors.muted }]}>{showLogin ? 'Войдите, чтобы продолжить работу.' : 'Подключите приложение к рабочему аккаунту.'}</Text></View>

		{pendingLink && <Card style={styles.linkConfirmation}><Text style={[styles.confirmationTitle, { color: colors.text }]}>Подтвердите активацию</Text><Text style={[styles.confirmationBody, { color: colors.muted }]}>Ссылка активирует рабочий аккаунт на этом устройстве. Она одноразовая и действует ограниченное время.</Text><ActionButton label="Активировать приложение" onPress={confirmLinkActivation} disabled={busy} /><ActionButton label="Отмена" variant="quiet" onPress={cancelLinkActivation} disabled={busy} /></Card>}

		{!pendingLink && !showLogin && <View style={styles.activationPanel}><View style={[styles.qrMark, { backgroundColor: colors.accentSoft }]}><QrCode color={colors.accent} size={42} strokeWidth={1.7} /></View><Text style={[styles.panelTitle, { color: colors.text }]}>Подключение по QR</Text><Text style={[styles.panelBody, { color: colors.muted }]}>Отсканируйте одноразовый код, который создал менеджер.</Text><ActionButton label="Сканировать QR" icon={Camera} onPress={() => void startScanning()} disabled={busy} /><ActionButton label="Войти по email" icon={Mail} variant="secondary" onPress={() => { setShowLogin(true); setLoginMessage(null) }} disabled={busy} /></View>}

		{!pendingLink && showLogin && <View style={styles.loginPanel}><Text style={[styles.panelTitle, { color: colors.text }]}>Вход по email</Text><Text style={[styles.panelBody, { color: colors.muted }]}>Используйте личные данные, выданные менеджером.</Text><View style={styles.fieldGroup}><Text style={[styles.fieldLabel, { color: colors.text }]}>Электронная почта</Text><TextInput accessibilityLabel="Электронная почта" style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceRaised }]} value={loginEmail} onChangeText={setLoginEmail} placeholder="name@example.com" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" editable={!busy && !loginSubmitting} returnKeyType="next" /></View><View style={styles.fieldGroup}><Text style={[styles.fieldLabel, { color: colors.text }]}>Пароль</Text><View style={[styles.passwordField, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}><TextInput accessibilityLabel="Пароль" style={[styles.passwordInput, { color: colors.text }]} value={loginPassword} onChangeText={setLoginPassword} placeholder="Введите пароль" placeholderTextColor={colors.muted} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" editable={!busy && !loginSubmitting} returnKeyType="done" onSubmitEditing={() => void submitLogin()} /><Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Скрыть пароль' : 'Показать пароль'} onPress={() => setShowPassword((value) => !value)} hitSlop={8} disabled={busy || loginSubmitting}>{showPassword ? <EyeOff color={colors.muted} size={20} /> : <Eye color={colors.muted} size={20} />}</Pressable></View></View>{loginMessage && <Text accessibilityRole="alert" style={[styles.loginError, { color: colors.danger }]}>{loginMessage}</Text>}<ActionButton label={busy || loginSubmitting ? 'Выполняем вход…' : 'Войти'} icon={LogIn} disabled={busy || loginSubmitting} onPress={() => void submitLogin()} /><ActionButton label="Вернуться к QR-активации" variant="quiet" onPress={() => { setShowLogin(false); setLoginMessage(null) }} disabled={busy || loginSubmitting} /></View>}

		{message && <View accessibilityRole="alert" style={[styles.message, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.messageText, { color: colors.text }]}>{message}</Text>{message.includes('настройках') && <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}><Text style={[styles.settingsLink, { color: colors.accent }]}>Открыть настройки</Text></Pressable>}</View>}
		{busy && !loginSubmitting && <View style={styles.busy}><ActivityIndicator color={colors.accent} /><Text style={[styles.busyText, { color: colors.muted }]}>Проверяем код активации…</Text></View>}
	</Screen>
}

function ScannerView({ colors, onClose, onBarcodeScanned }: { colors: ThemeColors; onClose: () => void; onBarcodeScanned?: (result: BarcodeScanningResult) => void }) {
	const insets = useSafeAreaInsets()
	return <View style={styles.scanner}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onBarcodeScanned}><View style={styles.scannerOverlay} pointerEvents="box-none"><View style={[styles.scannerTop, { paddingTop: insets.top + 12 }]}><Pressable accessibilityRole="button" accessibilityLabel="Закрыть сканер" onPress={onClose} style={[styles.scannerControl, { backgroundColor: colors.surface }]}><ChevronLeft color={colors.text} size={24} /></Pressable><Text style={[styles.scannerBrand, { color: colors.onAccent }]}>VIZAJE STAFF</Text><View style={styles.scannerControlPlaceholder} /></View><View style={styles.scanCenter}><View style={[styles.scanFrame, { borderColor: colors.accent }]} /></View><View style={[styles.scannerBottom, { paddingBottom: insets.bottom + 20 }]}><Text style={styles.scannerHint}>Наведите камеру на QR-код</Text></View></View></CameraView></View>
}

const styles = StyleSheet.create({
	content: { gap: 28 },
	brandBlock: { gap: 8, paddingTop: 8 },
	brand: { fontSize: 11, fontWeight: '600', letterSpacing: 1.4 },
	title: { fontSize: 32, fontWeight: '600', letterSpacing: -0.9 },
	subtitle: { fontSize: 16, lineHeight: 23 },
	activationPanel: { alignItems: 'center', gap: 14, paddingTop: 22 },
	qrMark: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', borderRadius: 28, marginBottom: 4 },
	panelTitle: { fontSize: 21, fontWeight: '600', textAlign: 'center' },
	panelBody: { maxWidth: 320, fontSize: 16, lineHeight: 23, textAlign: 'center', marginBottom: 8 },
	loginPanel: { gap: 16 },
	fieldGroup: { gap: 8 },
	fieldLabel: { fontSize: 14, fontWeight: '600' },
	input: { minHeight: 52, borderWidth: 1, borderRadius: 16, paddingHorizontal: 15, fontSize: 16 },
	passwordField: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, paddingLeft: 15, paddingRight: 15 },
	passwordInput: { flex: 1, minHeight: 50, paddingVertical: 0, paddingRight: 10, fontSize: 16 },
	loginError: { fontSize: 14, lineHeight: 20 },
	message: { gap: 8, borderRadius: 16, padding: 14 },
	messageText: { fontSize: 14, lineHeight: 20 },
	settingsLink: { fontSize: 14, fontWeight: '600' },
	linkConfirmation: { gap: 14 },
	confirmationTitle: { fontSize: 18, fontWeight: '600' },
	confirmationBody: { fontSize: 15, lineHeight: 22 },
	busy: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
	busyText: { fontSize: 15 },
	scanner: { flex: 1, backgroundColor: '#000000' },
	scannerOverlay: { flex: 1, justifyContent: 'space-between' },
	scannerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
	scannerControl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
	scannerControlPlaceholder: { width: 44, height: 44 },
	scannerBrand: { fontSize: 11, fontWeight: '600', letterSpacing: 1.4 },
	scanCenter: { alignItems: 'center', justifyContent: 'center' },
	scanFrame: { width: 238, height: 238, borderWidth: 3, borderRadius: 28 },
	scannerBottom: { alignItems: 'center', paddingHorizontal: 20 },
	scannerHint: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
})

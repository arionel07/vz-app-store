import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { useURL } from 'expo-linking'
import { useRouter } from 'expo-router'
import { Camera, QrCode, ShieldCheck } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { ApiError, isNetworkError } from '../src/api/client'
import { createActivationLinkGate, parseActivationPayload, type ActivationPayload } from '../src/auth/activation-payload'
import { useAuth } from '../src/auth/auth-context'
import { ActionButton, Card, Screen, ScreenHeader } from '../src/components/ui'
import { useAppTheme } from '../src/theme'

function activationError(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === 'INVALID_ACTIVATION' || error.status === 401) return 'Код недействителен, уже использован или срок его действия истёк.'
		if (error.code === 'RATE_LIMITED' || error.status === 429) return 'Слишком много попыток. Получите новый код и повторите позже.'
		if (isNetworkError(error)) return 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.'
	}
	return 'Не удалось активировать приложение. Повторите попытку или запросите новый QR-код.'
}

export default function ActivationScreen() {
	const router = useRouter()
	const { colors } = useAppTheme()
	const { redeemActivation } = useAuth()
	const [permission, requestPermission] = useCameraPermissions()
	const [scanning, setScanning] = useState(false)
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const [pendingLink, setPendingLink] = useState<ActivationPayload | null>(null)
	const scanLocked = useRef(false)
	const busyRef = useRef(false)
	const lastUrl = useRef<string | null>(null)
	const linkGate = useRef(createActivationLinkGate())
	const url = useURL()
	const activationLinkBaseUrl = process.env.EXPO_PUBLIC_ACTIVATION_LINK_BASE_URL

	const redeemPayload = useCallback(async (payload: ActivationPayload) => {
		if (scanLocked.current || busyRef.current) return
		scanLocked.current = true
		busyRef.current = true
		setScanning(false)
		setMessage(null)
		setBusy(true)
		try {
			await redeemActivation(payload.secret)
			router.replace('/(tabs)')
		} catch (error) {
			setMessage(activationError(error))
			scanLocked.current = false
		} finally {
			busyRef.current = false
			setBusy(false)
		}
	}, [redeemActivation, router])

	useEffect(() => {
		if (!url || url === lastUrl.current) return
		lastUrl.current = url
		const payload = parseActivationPayload(url, activationLinkBaseUrl)
		if (!payload) {
			setMessage('Ссылка активации недействительна или больше не поддерживается.')
			return
		}
		if (!linkGate.current(payload)) return
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

	return <Screen>
		<ScreenHeader title="Активация" subtitle="Подключите мобильное приложение к профилю." back />
		<View style={styles.hero}><View style={[styles.qrMark, { backgroundColor: colors.accentSoft }]}><QrCode color={colors.text} size={42} strokeWidth={1.7} /></View><Text style={[styles.heroTitle, { color: colors.text }]}>Сканирование QR-кода</Text><Text style={[styles.heroBody, { color: colors.muted }]}>Попросите менеджера создать одноразовый код активации и наведите камеру на QR-код.</Text></View>
		{pendingLink && <Card style={styles.linkConfirmation}><Text style={[styles.confirmationTitle, { color: colors.text }]}>Подтвердите активацию</Text><Text style={[styles.confirmationBody, { color: colors.muted }]}>Ссылка активирует рабочий аккаунт на этом устройстве. Она одноразовая и действует ограниченное время.</Text><ActionButton label="Активировать приложение" onPress={confirmLinkActivation} /><ActionButton label="Отмена" variant="secondary" onPress={cancelLinkActivation} /></Card>}
		{!pendingLink && scanning && <View style={styles.cameraShell}><CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanLocked.current ? undefined : onBarcodeScanned}><View style={styles.scanOverlay}><View style={[styles.scanFrame, { borderColor: colors.onAccent }]} /><Text style={styles.scanHint}>Наведите камеру на QR-код</Text></View></CameraView><ActionButton label="Закрыть камеру" variant="secondary" onPress={() => setScanning(false)} /></View>}
		<Card><View style={styles.infoRow}><ShieldCheck color={colors.success} size={21} /><Text style={[styles.infoText, { color: colors.text }]}>Код используется один раз и не сохраняется в приложении.</Text></View></Card>
		{message && <View accessibilityRole="alert" style={[styles.message, { backgroundColor: colors.accentSoft }]}><Text style={[styles.messageText, { color: colors.text }]}>{message}</Text>{message.includes('настройках') && <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}><Text style={[styles.settingsLink, { color: colors.text }]}>Открыть настройки</Text></Pressable>}</View>}
		{busy ? <View style={styles.busy}><ActivityIndicator color={colors.text} /><Text style={[styles.busyText, { color: colors.muted }]}>Проверяем код активации…</Text></View> : !scanning && !pendingLink && <ActionButton label="Сканировать QR-код" icon={Camera} onPress={() => void startScanning()} />}
		{!scanning && !pendingLink && <ActionButton label="Вернуться на главную" variant="quiet" onPress={() => router.replace('/(tabs)')} />}
	</Screen>
}

const styles = StyleSheet.create({
	hero: { alignItems: 'center', gap: 12, paddingTop: 18 },
	qrMark: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center', borderRadius: 30 },
	heroTitle: { marginTop: 4, fontSize: 21, fontWeight: '800', textAlign: 'center' },
	heroBody: { maxWidth: 330, fontSize: 15, lineHeight: 22, textAlign: 'center' },
	infoRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
	infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
	cameraShell: { gap: 11 },
	camera: { height: 340, overflow: 'hidden', borderRadius: 20 },
	scanOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, backgroundColor: 'rgba(0,0,0,0.18)' },
	scanFrame: { width: 220, height: 220, borderWidth: 3, borderRadius: 20 },
	scanHint: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
	message: { gap: 8, borderRadius: 14, padding: 14 },
	messageText: { fontSize: 14, lineHeight: 20 },
	settingsLink: { fontSize: 14, fontWeight: '700' },
	busy: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
	busyText: { fontSize: 15 },
	linkConfirmation: { gap: 14 },
	confirmationTitle: { fontSize: 18, fontWeight: '800' },
	confirmationBody: { fontSize: 15, lineHeight: 22 },
})

import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { registerPushDevice, removePushDevice } from '../api/client'

const DEVICE_ID_KEY = 'vizaje.notifications.device-id'

export type PushRegistrationResult = 'registered' | 'denied' | 'unavailable'

async function getDeviceId(): Promise<string> {
	const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY)
	if (existing?.trim()) return existing
	const created = Crypto.randomUUID()
	await SecureStore.setItemAsync(DEVICE_ID_KEY, created)
	return created
}

export async function requestAndRegisterPushDevice(token: string): Promise<PushRegistrationResult> {
	const permission = await Notifications.getPermissionsAsync()
	const nextPermission = permission.granted ? permission : await Notifications.requestPermissionsAsync()
	if (!nextPermission.granted) return 'denied'

	const projectId = Constants.expoConfig?.extra?.eas?.projectId
	try {
		const pushToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
		if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Основные уведомления', importance: Notifications.AndroidImportance.DEFAULT })
		await registerPushDevice(token, { deviceId: await getDeviceId(), platform: Platform.OS === 'ios' ? 'ios' : 'android', expoPushToken: pushToken.data })
		return 'registered'
	} catch {
		return 'unavailable'
	}
}

export async function unregisterCurrentPushDevice(token: string): Promise<void> {
	const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY)
	if (deviceId) await removePushDevice(token, deviceId)
}

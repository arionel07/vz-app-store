import type { NotificationResponse } from 'expo-notifications'

type NotificationsApi = Pick<
	typeof import('expo-notifications'),
	'setNotificationHandler' | 'addNotificationResponseReceivedListener' | 'getLastNotificationResponseAsync'
>

const configuredNotifications = new WeakSet<object>()

export function supportsNativeNotifications(platform: string): platform is 'ios' | 'android' {
	return platform === 'ios' || platform === 'android'
}

export function startNotificationBridge(
	platform: string,
	notifications: NotificationsApi,
	onResponse: (response: NotificationResponse) => void,
): () => void {
	if (!supportsNativeNotifications(platform)) return () => undefined

	if (!configuredNotifications.has(notifications)) {
		notifications.setNotificationHandler({
			handleNotification: async () => ({
				shouldShowAlert: true,
				shouldShowBanner: true,
				shouldShowList: true,
				shouldPlaySound: false,
				shouldSetBadge: false,
			}),
		})
		configuredNotifications.add(notifications)
	}

	let active = true
	const subscription = notifications.addNotificationResponseReceivedListener(onResponse)
	void notifications.getLastNotificationResponseAsync().then((response) => {
		if (active && response) onResponse(response)
	}).catch(() => undefined)

	return () => {
		active = false
		subscription.remove()
	}
}

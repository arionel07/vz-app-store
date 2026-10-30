import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { useAuth } from '../auth/auth-context'
import { openNotificationTarget } from './navigation'

Notifications.setNotificationHandler({
	handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

export function NotificationBridge() {
	const router = useRouter()
	const { status } = useAuth()
	const pending = useRef<unknown>(null)
	const handled = useRef(new Set<string>())

	useEffect(() => {
		const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
			const id = response.notification.request.identifier
			if (handled.current.has(id)) return
			handled.current.add(id)
			const target = response.notification.request.content.data?.target
			if (status === 'authenticated') openNotificationTarget(router, target)
			else pending.current = target
		})
		void Notifications.getLastNotificationResponseAsync().then((response) => {
			if (!response) return
			const id = response.notification.request.identifier
			if (handled.current.has(id)) return
			handled.current.add(id)
			pending.current = response.notification.request.content.data?.target
			if (status === 'authenticated') { openNotificationTarget(router, pending.current); pending.current = null }
		})
		return () => subscription.remove()
	}, [router, status])

	useEffect(() => {
		if (status !== 'authenticated' || pending.current === null) return
		if (openNotificationTarget(router, pending.current)) pending.current = null
	}, [router, status])

	return null
}

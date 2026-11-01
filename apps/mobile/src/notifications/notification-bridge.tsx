import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { useAuth } from '../auth/auth-context'
import { openNotificationTarget } from './navigation'
import { startNotificationBridge } from './notification-runtime'

export function NotificationBridge() {
	const router = useRouter()
	const { status } = useAuth()
	const pending = useRef<unknown>(null)
	const handled = useRef(new Set<string>())

	useEffect(() => {
		return startNotificationBridge(Platform.OS, Notifications, (response) => {
			const id = response.notification.request.identifier
			if (handled.current.has(id)) return
			handled.current.add(id)
			const target = response.notification.request.content.data?.target
			if (status === 'authenticated') openNotificationTarget(router, target)
			else pending.current = target
		})
	}, [router, status])

	useEffect(() => {
		if (status !== 'authenticated' || pending.current === null) return
		if (openNotificationTarget(router, pending.current)) pending.current = null
	}, [router, status])

	return null
}

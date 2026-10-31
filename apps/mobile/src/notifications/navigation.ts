import type { Href } from 'expo-router'
import { notificationTargetSchema, type NotificationTarget } from '@vizaje/contracts'

export function notificationTargetHref(target: NotificationTarget): Href {
	if (target.kind === 'task') return `/task/${target.id}` as Href
	if (target.kind === 'quiz') return `/quiz/${target.id}` as Href
	if (target.kind === 'attempt') return `/attempt/${target.id}` as Href
	if (target.kind === 'schedule') return '/schedule'
	if (target.kind === 'photo_report') return '/(tabs)/photos'
	if (target.kind === 'knowledge') return `/knowledge/${target.id}` as Href
	if (target.kind === 'operation') return `/operations/record/${target.id}` as Href
	return `/announcement/${target.id}` as Href
}

export function openNotificationTarget(router: { push: (href: Href) => void }, value: unknown): boolean {
	const parsed = notificationTargetSchema.safeParse(value)
	if (!parsed.success) return false
	router.push(notificationTargetHref(parsed.data))
	return true
}

import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Text } from 'react-native'
import { getMyAnnouncement } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { Card, InlineMessage, Screen, ScreenHeader } from '../../src/components/ui'
import { useAppTheme } from '../../src/theme'

export default function AnnouncementScreen() {
	const { id } = useLocalSearchParams<{ id: string }>()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [announcement, setAnnouncement] = useState<{ title: string; body: string; publishedAt: string } | null>(null)
	const [error, setError] = useState(false)

	useEffect(() => { if (!id) return; void requestAuthenticated((token) => getMyAnnouncement(token, id)).then(setAnnouncement).catch(() => setError(true)) }, [id, requestAuthenticated])

	return <Screen><ScreenHeader title="Объявление" back />{error ? <InlineMessage title="Не удалось открыть объявление" body="Проверьте подключение и повторите попытку." /> : !announcement ? <ActivityIndicator color={colors.text} /> : <Card><Text style={{ color: colors.text, fontSize: 21, fontWeight: '600' }}>{announcement.title}</Text><Text style={{ color: colors.muted, fontSize: 13, marginTop: 8 }}>{new Date(announcement.publishedAt).toLocaleString('ru-RU')}</Text><Text style={{ color: colors.text, fontSize: 16, lineHeight: 24, marginTop: 18 }}>{announcement.body}</Text></Card>}</Screen>
}

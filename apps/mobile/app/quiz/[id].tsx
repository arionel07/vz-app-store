import { useLocalSearchParams, useRouter } from 'expo-router'
import { BookOpen, CircleAlert, Play } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { ApiError, getAvailableQuiz, listMyAttempts, startQuizAttempt } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { ActionButton, Card, InlineMessage, Screen, ScreenHeader } from '../../src/components/ui'
import type { QuizStaffResponse } from '@vizaje/contracts'
import { useAppTheme } from '../../src/theme'

function errorText(error: unknown): string {
	if (error instanceof ApiError && error.status === 0) return 'Нет соединения с сервером. Проверьте подключение.'
	if (error instanceof ApiError && (error.status === 403 || error.code === 'QUIZ_NOT_AVAILABLE')) return 'Этот тест больше недоступен для вашей учётной записи.'
	return 'Не удалось открыть тест. Повторите попытку.'
}

function questionLabel(count: number): string {
	if (count % 10 === 1 && count % 100 !== 11) return `${count} вопрос`
	if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return `${count} вопроса`
	return `${count} вопросов`
}

export default function QuizIntroductionScreen() {
	const router = useRouter()
	const { id } = useLocalSearchParams<{ id: string }>()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [quiz, setQuiz] = useState<QuizStaffResponse | null>(null)
	const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [starting, setStarting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		if (!id) return
		setLoading(true)
		setError(null)
		try {
			const [quizResponse, attemptsResponse] = await Promise.all([
				requestAuthenticated((token) => getAvailableQuiz(token, id)),
				requestAuthenticated((token) => listMyAttempts(token, { page: 1, pageSize: 20, quizId: id, status: 'in_progress' })),
			])
			setQuiz(quizResponse)
			setActiveAttemptId(attemptsResponse.data.find((attempt) => attempt.status === 'in_progress')?.id ?? null)
		} catch (loadError) {
			setError(errorText(loadError))
		} finally {
			setLoading(false)
		}
	}, [id, requestAuthenticated])

	useEffect(() => { void load() }, [load])

	const openAttempt = (attemptId: string) => router.push({ pathname: '/quiz/[id]/attempt', params: { id, attemptId } })
	const start = async () => {
		if (!id) return
		setStarting(true)
		setError(null)
		try {
			const response = await requestAuthenticated((token) => startQuizAttempt(token, id), { retryUnauthorized: false })
			openAttempt(response.id)
		} catch (startError) {
			setError(errorText(startError))
		} finally {
			setStarting(false)
		}
	}

	return <Screen>
		<ScreenHeader title="О тесте" back backFallback="/(tabs)/quizzes" />
		{loading ? <View style={styles.loading}><ActivityIndicator color={colors.text} /><Text style={[styles.muted, { color: colors.muted }]}>Загружаем тест…</Text></View> : error && !quiz ? <InlineMessage title="Тест недоступен" body={error} actionLabel="Повторить" onAction={() => void load()} /> : quiz && <>
			<Card><View style={[styles.icon, { backgroundColor: colors.accentSoft }]}><BookOpen color={colors.accent} size={24} /></View><Text style={[styles.title, { color: colors.text }]}>{quiz.title}</Text><View style={[styles.meta, { borderTopColor: colors.border }]}><View><Text style={[styles.metaLabel, { color: colors.muted }]}>Вопросы</Text><Text style={[styles.metaValue, { color: colors.text }]}>{questionLabel(quiz.questions.length)}</Text></View><View><Text style={[styles.metaLabel, { color: colors.muted }]}>Проходной балл</Text><Text style={[styles.metaValue, { color: colors.text }]}>{quiz.passingScore}%</Text></View><View><Text style={[styles.metaLabel, { color: colors.muted }]}>Ревизия</Text><Text style={[styles.metaValue, { color: colors.text }]}>{quiz.revisionNumber}</Text></View></View></Card>
			{error && <View style={[styles.warning, { backgroundColor: colors.surfaceRaised }]}><CircleAlert color={colors.warning} size={19} /><Text style={[styles.warningText, { color: colors.text }]}>{error}</Text></View>}
			<ActionButton label={starting ? 'Подготавливаем…' : activeAttemptId ? 'Продолжить попытку' : 'Начать тест'} icon={starting ? undefined : Play} disabled={starting} onPress={() => void (activeAttemptId ? openAttempt(activeAttemptId) : start())} />
		</>}
	</Screen>
}

const styles = StyleSheet.create({
	loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 12 },
	muted: { fontSize: 14, lineHeight: 20 },
	icon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16, marginBottom: 14 },
	title: { fontSize: 24, fontWeight: '600', lineHeight: 30 },
	meta: { flexDirection: 'row', gap: 18, marginTop: 24, paddingTop: 17, borderTopWidth: StyleSheet.hairlineWidth },
	metaLabel: { fontSize: 12 },
	metaValue: { marginTop: 4, fontSize: 15, fontWeight: '700' },
	warning: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, padding: 14 },
	warningText: { flex: 1, fontSize: 14, lineHeight: 20 },
})

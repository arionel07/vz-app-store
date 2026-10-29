import { useLocalSearchParams, useRouter } from 'expo-router'
import { CheckCircle2, LoaderCircle, RotateCcw, XCircle } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { ApiError, getMyAttempt, startQuizAttempt } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { ActionButton, Card, InlineMessage, Screen, ScreenHeader } from '../../src/components/ui'
import type { AttemptResponse } from '@vizaje/contracts'
import { useAppTheme } from '../../src/theme'

function errorText(error: unknown): string {
	if (error instanceof ApiError && error.status === 0) return 'Нет соединения с сервером. Проверьте подключение.'
	if (error instanceof ApiError && error.status === 403) return 'У вас нет доступа к этой попытке.'
	return 'Не удалось загрузить результат. Повторите попытку.'
}

function dateText(value: string): string {
	return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function AttemptResultScreen() {
	const router = useRouter()
	const { attemptId } = useLocalSearchParams<{ attemptId: string }>()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [attempt, setAttempt] = useState<AttemptResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [retrying, setRetrying] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		if (!attemptId) return
		setLoading(true)
		setError(null)
		try {
			setAttempt(await requestAuthenticated((token) => getMyAttempt(token, attemptId)))
		} catch (loadError) {
			setError(errorText(loadError))
		} finally {
			setLoading(false)
		}
	}, [attemptId, requestAuthenticated])

	useEffect(() => { void load() }, [load])

	const retry = async () => {
		if (!attempt) return
		setRetrying(true)
		setError(null)
		try {
			const next = await requestAuthenticated((token) => startQuizAttempt(token, attempt.quizId), { retryUnauthorized: false })
			router.replace({ pathname: '/quiz/[id]/attempt', params: { id: attempt.quizId, attemptId: next.id } })
		} catch (retryError) {
			setError(errorText(retryError))
		} finally {
			setRetrying(false)
		}
	}

	if (loading) return <Screen><ScreenHeader title="Результат" back backFallback="/(tabs)/quizzes" /><View style={styles.loading}><ActivityIndicator color={colors.text} /></View></Screen>
	if (error && !attempt) return <Screen><ScreenHeader title="Результат" back backFallback="/(tabs)/quizzes" /><InlineMessage title="Не удалось открыть результат" body={error} actionLabel="Повторить" onAction={() => void load()} /></Screen>
	if (!attempt) return null

	const quiz = attempt.quiz
	const isSubmitted = attempt.status === 'submitted'
	const needsReview = attempt.reviewStatus === 'pending'
	const passed = attempt.passed === true

	return <Screen>
		<ScreenHeader title={isSubmitted ? 'Результат' : 'Незавершённый тест'} back backFallback="/(tabs)/quizzes" />
		{isSubmitted ? <Card style={styles.resultCard}><View style={[styles.resultIcon, { backgroundColor: needsReview ? colors.surfaceRaised : passed ? colors.accentSoft : colors.surfaceRaised }]}>{needsReview ? <LoaderCircle color={colors.muted} size={34} /> : passed ? <CheckCircle2 color={colors.success} size={34} /> : <XCircle color={colors.danger} size={34} />}</View><Text style={[styles.resultTitle, { color: colors.text }]}>{needsReview ? 'Ответы проверяются' : passed ? 'Тест пройден' : 'Тест не пройден'}</Text>{needsReview ? <Text style={[styles.detail, { color: colors.muted }]}>Свободные ответы и фотографии проверит менеджер. Итоговый балл появится после проверки.</Text> : <Text style={[styles.score, { color: passed ? colors.success : colors.danger }]}>{attempt.scorePercent ?? 0}%</Text>}<View style={[styles.details, { borderTopColor: colors.border }]}><Text style={[styles.detail, { color: colors.muted }]}>Ревизия {attempt.revisionNumber}</Text><Text style={[styles.detail, { color: colors.muted }]}>{dateText(attempt.submittedAt ?? attempt.startedAt)}</Text></View></Card> : <InlineMessage title="Попытка не завершена" body="Вы можете продолжить отвечать на вопросы с сохранённого места." actionLabel="Продолжить" onAction={() => router.replace({ pathname: '/quiz/[id]/attempt', params: { id: attempt.quizId, attemptId: attempt.id } })} />}
		{error && <InlineMessage title="Не удалось начать новую попытку" body={error} actionLabel="Повторить" onAction={() => void retry()} />}
		{isSubmitted && <ActionButton label={retrying ? 'Готовим новую попытку…' : 'Пройти ещё раз'} icon={RotateCcw} disabled={retrying} variant="secondary" onPress={() => void retry()} />}
		<ActionButton label="Вернуться к тестам" variant={isSubmitted ? 'quiet' : 'secondary'} onPress={() => router.replace('/(tabs)/quizzes')} />
	</Screen>
}

const styles = StyleSheet.create({
	loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
	resultCard: { alignItems: 'center', gap: 9 },
	resultIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 24, marginBottom: 4 },
	resultTitle: { fontSize: 24, fontWeight: '600', textAlign: 'center' },
	score: { marginTop: 4, fontSize: 44, fontWeight: '600' },
	details: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 14, paddingTop: 15, borderTopWidth: StyleSheet.hairlineWidth },
	detail: { fontSize: 13 },
})

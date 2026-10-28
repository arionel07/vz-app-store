import { useFocusEffect, useRouter } from 'expo-router'
import { ClipboardList, Inbox } from 'lucide-react-native'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { ApiError, listAvailableQuizzes, listMyAttempts } from '../../src/api/client'
import { useAuth } from '../../src/auth/auth-context'
import { Card, EmptyState, InlineMessage, Screen, ScreenHeader, SectionTitle } from '../../src/components/ui'
import type { AttemptResponse, QuizStaffResponse } from '@vizaje/contracts'
import { useAppTheme } from '../../src/theme'

function errorText(error: unknown): string {
	if (error instanceof ApiError && error.status === 0) return 'Не удалось связаться с сервером. Проверьте подключение.'
	if (error instanceof ApiError && error.status === 403) return 'У вас нет доступа к этому разделу.'
	return 'Не удалось загрузить тесты. Повторите попытку.'
}

function dateText(value: string): string {
	return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function QuizzesScreen() {
	const router = useRouter()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [quizzes, setQuizzes] = useState<QuizStaffResponse[]>([])
	const [attempts, setAttempts] = useState<AttemptResponse[]>([])
	const [loading, setLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const hasLoaded = useRef(false)

	const load = useCallback(async (isRefresh = false) => {
		if (isRefresh) setRefreshing(true)
		else if (!hasLoaded.current) setLoading(true)
		setError(null)
		try {
			const [quizResponse, attemptResponse] = await Promise.all([
				requestAuthenticated((token) => listAvailableQuizzes(token)),
				requestAuthenticated((token) => listMyAttempts(token)),
			])
			setQuizzes(quizResponse.data)
			setAttempts(attemptResponse.data)
			hasLoaded.current = true
		} catch (loadError) {
			setError(errorText(loadError))
		} finally {
			setLoading(false)
			setRefreshing(false)
		}
	}, [requestAuthenticated])

	useFocusEffect(useCallback(() => { void load() }, [load]))

	const activeAttempts = useMemo(() => new Map(attempts.filter((attempt) => attempt.status === 'in_progress').map((attempt) => [attempt.quizId, attempt])), [attempts])
	const submittedAttempts = attempts.filter((attempt) => attempt.status === 'submitted')

	const openQuiz = (quizId: string) => router.push({ pathname: '/quiz/[id]', params: { id: quizId } })
	const openAttempt = (attempt: AttemptResponse) => {
		if (attempt.status === 'in_progress') router.push({ pathname: '/quiz/[id]/attempt', params: { id: attempt.quizId, attemptId: attempt.id } })
		else router.push({ pathname: '/attempt/[attemptId]', params: { attemptId: attempt.id } })
	}

	return <Screen refreshing={refreshing} onRefresh={() => void load(true)}>
		<ScreenHeader title="Тесты" subtitle="Проверяйте знания о продуктах и сервисе." />
		{loading ? <View style={styles.loading}><ActivityIndicator color={colors.text} /><Text style={[styles.muted, { color: colors.muted }]}>Загружаем доступные тесты…</Text></View> : error ? <InlineMessage title="Не удалось загрузить тесты" body={error} actionLabel="Повторить" onAction={() => void load()} /> : <>
			<SectionTitle>Доступные тесты</SectionTitle>
			{quizzes.length === 0 ? <EmptyState icon={Inbox} title="Пока нет доступных тестов" body="Опубликованные тесты для назначенных магазинов появятся здесь." /> : <View style={styles.stack}>{quizzes.map((quiz) => { const active = activeAttempts.get(quiz.id); return <Pressable key={quiz.id} accessibilityRole="button" accessibilityLabel={`${active ? 'Продолжить' : 'Начать'} тест ${quiz.title}`} onPress={() => openQuiz(quiz.id)} style={({ pressed }) => [styles.quizCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}><View style={[styles.quizIcon, { backgroundColor: colors.accentSoft }]}><ClipboardList color={colors.text} size={21} /></View><View style={styles.quizCopy}><Text style={[styles.quizTitle, { color: colors.text }]}>{quiz.title}</Text>{quiz.description && <Text numberOfLines={3} style={[styles.quizDescription, { color: colors.muted }]}>{quiz.description}</Text>}<Text style={[styles.quizMeta, { color: colors.muted }]}>{quiz.questions.length} {quiz.questions.length === 1 ? 'вопрос' : 'вопроса'} · Проходной балл {quiz.passingScore}%</Text><Text style={[styles.quizAction, { color: colors.text }]}>{active ? 'Продолжить попытку' : 'Начать тест'}</Text></View></Pressable> })}</View>}

			<SectionTitle>История попыток</SectionTitle>
			{submittedAttempts.length === 0 ? <EmptyState icon={Inbox} title="История пока пуста" body="Завершённые попытки появятся здесь после отправки ответов." /> : <View style={styles.stack}>{submittedAttempts.map((attempt) => <Pressable key={attempt.id} accessibilityRole="button" onPress={() => openAttempt(attempt)} style={({ pressed }) => [styles.historyRow, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}><View style={styles.historyCopy}><Text style={[styles.historyTitle, { color: colors.text }]}>{attempt.quiz?.title ?? 'Тест'}</Text><Text style={[styles.muted, { color: colors.muted }]}>Попытка · {dateText(attempt.submittedAt ?? attempt.startedAt)} · Ревизия {attempt.revisionNumber}</Text></View><View style={styles.historyResult}><Text style={[styles.score, { color: attempt.passed ? colors.success : colors.danger }]}>{attempt.scorePercent ?? 0}%</Text><Text style={[styles.muted, { color: colors.muted }]}>{attempt.passed ? 'Пройден' : 'Не пройден'}</Text></View></Pressable>)}</View>}
		</>}
	</Screen>
}

const styles = StyleSheet.create({
	loading: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 12 },
	stack: { gap: 12 },
	mute: { fontSize: 14, lineHeight: 20 },
	muted: { fontSize: 13, lineHeight: 18 },
	quizCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 13, borderWidth: 1, borderRadius: 18, padding: 17 },
	quizIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
	quizCopy: { flex: 1, gap: 6 },
	quizTitle: { fontSize: 17, fontWeight: '700' },
	quizDescription: { fontSize: 14, lineHeight: 20 },
	quizMeta: { fontSize: 13, lineHeight: 18 },
	quizAction: { marginTop: 2, fontSize: 14, fontWeight: '700' },
	historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 15 },
	historyCopy: { flex: 1, gap: 4 },
	historyTitle: { fontSize: 15, fontWeight: '700' },
	historyResult: { alignItems: 'flex-end', gap: 2 },
	score: { fontSize: 18, fontWeight: '800' },
})

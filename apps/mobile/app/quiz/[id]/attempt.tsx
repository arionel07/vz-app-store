import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowLeft, ArrowRight, Send } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { ApiError, getMyAttempt, submitQuizAttempt } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/auth-context'
import { answerMapFromDraft, type AttemptDraft } from '../../../src/quizzes/draft-store'
import { secureAttemptDraftStore } from '../../../src/quizzes/secure-draft-store'
import { createAnswerMap, progressPercent, selectAnswer, toSubmissionInput, unansweredCount, type AnswerMap } from '../../../src/quizzes/model'
import { ActionButton, Card, InlineMessage, ProgressBar, Screen, ScreenHeader } from '../../../src/components/ui'
import type { AttemptResponse, QuizStaffResponse } from '@vizaje/contracts'
import { useAppTheme } from '../../../src/theme'

function errorText(error: unknown): string {
	if (error instanceof ApiError && error.status === 0) return 'Ответы не отправлены: соединение с сервером потеряно. Проверьте результат через историю попыток.'
	if (error instanceof ApiError && error.status === 403) return 'У вас нет доступа к этой попытке.'
	return 'Не удалось загрузить попытку. Повторите попытку.'
}

export default function QuizAttemptScreen() {
	const router = useRouter()
	const { id, attemptId } = useLocalSearchParams<{ id: string; attemptId: string }>()
	const { colors } = useAppTheme()
	const { requestAuthenticated } = useAuth()
	const [attempt, setAttempt] = useState<AttemptResponse | null>(null)
	const [quiz, setQuiz] = useState<QuizStaffResponse | null>(null)
	const [answers, setAnswers] = useState<AnswerMap>({})
	const [questionIndex, setQuestionIndex] = useState(0)
	const [loading, setLoading] = useState(true)
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [draftError, setDraftError] = useState<string | null>(null)
	const saveQueue = useRef(Promise.resolve())

	const load = useCallback(async () => {
		if (!attemptId) return
		setLoading(true)
		setError(null)
		try {
			const response = await requestAuthenticated((token) => getMyAttempt(token, attemptId))
			if (response.status === 'submitted') {
				router.replace({ pathname: '/attempt/[attemptId]', params: { attemptId } })
				return
			}
			if (!response.quiz) throw new Error('Quiz content is missing')
			let existingDraft: AttemptDraft | null = null
			try {
				existingDraft = await secureAttemptDraftStore.load(response.id, response.quizId, response.revisionId)
			} catch {
				setDraftError('Не удалось прочитать сохранённые ответы. Продолжайте осторожно и отправьте тест до закрытия экрана.')
			}
			setAttempt(response)
			setQuiz(response.quiz)
			setAnswers(createAnswerMap(response.quiz, answerMapFromDraft(existingDraft)))
		} catch (loadError) {
			setError(errorText(loadError))
		} finally {
			setLoading(false)
		}
	}, [attemptId, requestAuthenticated, router])

	useEffect(() => { void load() }, [load])

	const persistAnswers = (nextAnswers: AnswerMap) => {
		if (!attempt || !quiz) return
		const questionIds = quiz.questions.map((question) => question.id)
		saveQueue.current = saveQueue.current.then(async () => {
			try {
				await secureAttemptDraftStore.save(attempt.id, attempt.quizId, attempt.revisionId, nextAnswers, questionIds)
				setDraftError(null)
			} catch {
				setDraftError('Не удалось сохранить черновик ответов. Не закрывайте экран до отправки теста.')
			}
		})
	}

	const select = (optionId: string) => {
		if (!quiz || submitting) return
		const question = quiz.questions[questionIndex]
		if (!question) return
		const next = selectAnswer(answers, question.id, optionId)
		setAnswers(next)
		persistAnswers(next)
	}

	const submit = async () => {
		if (!attempt || !quiz || submitting) return
		setSubmitting(true)
		setError(null)
		try {
			await saveQueue.current
			const response = await requestAuthenticated((token) => submitQuizAttempt(token, attempt.id, toSubmissionInput(quiz, answers)), { retryUnauthorized: false })
			try { await secureAttemptDraftStore.clear(attempt.id) } catch { /* A submitted result remains authoritative even if cleanup is unavailable. */ }
			router.replace({ pathname: '/attempt/[attemptId]', params: { attemptId: response.id } })
		} catch (submitError) {
			setError(errorText(submitError))
			setSubmitting(false)
		}
	}

	const confirmSubmit = () => {
		if (!quiz) return
		const remaining = unansweredCount(quiz, answers)
		Alert.alert('Отправить ответы?', remaining > 0 ? `Без ответа останется ${remaining} ${remaining === 1 ? 'вопрос' : 'вопроса'}. Результат рассчитает сервер.` : 'После отправки ответы нельзя будет изменить.', [
			{ text: 'Продолжить', style: 'cancel' },
			{ text: 'Отправить', onPress: () => void submit() },
		])
	}

	if (loading) return <Screen><ScreenHeader title="Тест" back backFallback="/(tabs)/quizzes" /><View style={styles.loading}><ActivityIndicator color={colors.text} /><Text style={[styles.muted, { color: colors.muted }]}>Загружаем вопросы…</Text></View></Screen>
	if (error && (!quiz || !attempt)) return <Screen><ScreenHeader title="Тест" back backFallback="/(tabs)/quizzes" /><InlineMessage title="Не удалось открыть попытку" body={error} actionLabel="Повторить" onAction={() => void load()} /></Screen>
	if (!quiz || !attempt) return null

	const question = quiz.questions[questionIndex]
	if (!question) return <Screen><ScreenHeader title="Тест" back backFallback="/(tabs)/quizzes" /><InlineMessage title="Тест пуст" body="В этой ревизии нет вопросов для прохождения." /></Screen>
	const selectedOption = answers[question.id]
	const isLast = questionIndex === quiz.questions.length - 1

	return <Screen contentStyle={styles.content}>
		<ScreenHeader title="Тест" back backFallback="/(tabs)/quizzes" />
		<View style={styles.progressHeader}><Text style={[styles.progressText, { color: colors.muted }]}>Прогресс</Text><Text style={[styles.progressText, { color: colors.text }]}>{progressPercent(questionIndex, quiz.questions.length)}%</Text></View>
		<ProgressBar value={progressPercent(questionIndex, quiz.questions.length)} />
		<Card style={styles.questionCard}><Text style={[styles.questionNumber, { color: colors.muted }]}>Вопрос {questionIndex + 1}</Text><Text accessibilityRole="header" style={[styles.questionText, { color: colors.text }]}>{question.prompt}</Text></Card>
		<View style={styles.options}>{question.options.map((option) => { const selected = selectedOption === option.id; return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => select(option.id)} style={({ pressed }) => [styles.option, { backgroundColor: selected ? colors.accentSoft : colors.surfaceRaised, borderColor: selected ? colors.accent : colors.border, opacity: pressed ? 0.72 : 1 }]}><View style={[styles.radio, { borderColor: selected ? colors.accent : colors.muted, backgroundColor: selected ? colors.accent : 'transparent' }]}>{selected && <View style={[styles.radioDot, { backgroundColor: colors.onAccent }]} />}</View><Text style={[styles.optionText, { color: colors.text }]}>{option.label}</Text></Pressable> })}</View>
		{draftError && <Text accessibilityRole="alert" style={[styles.draftError, { color: colors.warning }]}>{draftError}</Text>}
		{error && <InlineMessage title="Не удалось отправить ответы" body={error} actionLabel="Проверить результат" onAction={() => void load()} />}
		<View style={styles.navigation}>{questionIndex > 0 ? <ActionButton label="Назад" icon={ArrowLeft} variant="secondary" disabled={submitting} onPress={() => setQuestionIndex((index) => index - 1)} style={styles.navButton} /> : <View style={styles.navSpacer} />}{isLast ? <ActionButton label={submitting ? 'Отправляем…' : 'Отправить ответы'} icon={Send} disabled={submitting} onPress={confirmSubmit} style={styles.navButton} /> : <ActionButton label="Далее" icon={ArrowRight} disabled={submitting} onPress={() => setQuestionIndex((index) => index + 1)} style={styles.navButton} />}</View>
	</Screen>
}

const styles = StyleSheet.create({
	content: { gap: 16 },
	loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12 },
	muted: { fontSize: 14, lineHeight: 20 },
	progressHeader: { flexDirection: 'row', justifyContent: 'space-between' },
	progressText: { fontSize: 13, fontWeight: '700' },
	questionCard: { gap: 10 },
	questionNumber: { fontSize: 13, fontWeight: '700' },
	questionText: { fontSize: 23, fontWeight: '600', lineHeight: 30 },
	options: { gap: 10 },
	option: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
	radio: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 12 },
	radioDot: { width: 8, height: 8, borderRadius: 8 },
	optionText: { flex: 1, fontSize: 16, lineHeight: 22 },
	draftError: { fontSize: 13, lineHeight: 18 },
	navigation: { flexDirection: 'row', gap: 10, paddingTop: 2 },
	navButton: { flex: 1 },
	navSpacer: { flex: 1 },
})

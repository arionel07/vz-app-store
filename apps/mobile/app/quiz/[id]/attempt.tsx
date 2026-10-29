import * as Crypto from 'expo-crypto'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowLeft, ArrowRight, Image as ImageIcon, Send } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ApiError, getMyAttempt, submitQuizAttempt, uploadQuizAnswerPhoto } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/auth-context'
import { answerMapFromDraft, type AttemptDraft } from '../../../src/quizzes/draft-store'
import { secureAttemptDraftStore } from '../../../src/quizzes/secure-draft-store'
import { answerValue, createAnswerMap, progressPercent, selectedOptionIds, selectAnswer, toSubmissionInput, unansweredCount, type AnswerMap, type RichAnswer } from '../../../src/quizzes/model'
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
		const current = selectedOptionIds(answers[question.id] ?? null)
		const next = question.type === 'multiple_choice'
			? { ...answers, [question.id]: current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId] }
			: selectAnswer(answers, question.id, optionId)
		setAnswers(next)
		persistAnswers(next)
	}

	const updateRichAnswer = (update: RichAnswer) => {
		if (!quiz || submitting) return
		const question = quiz.questions[questionIndex]
		if (!question) return
		const next = { ...answers, [question.id]: { ...answerValue(answers[question.id] ?? null), ...update } }
		setAnswers(next)
		persistAnswers(next)
	}

	const pickPhoto = async () => {
		if (!quiz || !attempt || submitting) return
		const question = quiz.questions[questionIndex]
		if (!question) return
		const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(false)
		if (!permission.granted) { setError('Разрешите доступ к фотографиям в настройках устройства.'); return }
		const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
		if (result.canceled || !result.assets[0]) return
		setSubmitting(true)
		setError(null)
		try {
			const asset = result.assets[0]
			const photo = await requestAuthenticated((token) => uploadQuizAnswerPhoto(token, attempt.id, question.id, { uri: asset.uri, name: asset.fileName ?? `quiz-${Crypto.randomUUID()}.jpg`, type: asset.mimeType === 'image/png' ? 'image/png' : asset.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg' }, Crypto.randomUUID()), { retryUnauthorized: false })
			const next = { ...answers, [question.id]: { ...answerValue(answers[question.id] ?? null), photoId: photo.id } }
			setAnswers(next)
			persistAnswers(next)
		} catch (photoError) {
			setError(photoError instanceof ApiError && photoError.status === 0 ? 'Фотография не загружена: проверьте соединение.' : 'Не удалось прикрепить фотографию.')
		} finally {
			setSubmitting(false)
		}
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
	const selectedOptions = selectedOptionIds(answers[question.id] ?? null)
	const currentAnswer = answerValue(answers[question.id] ?? null)
	const questionConfig = question.config ?? {}
	const isLast = questionIndex === quiz.questions.length - 1

	return <Screen contentStyle={styles.content}>
		<ScreenHeader title="Тест" back backFallback="/(tabs)/quizzes" />
		<View style={styles.progressHeader}><Text style={[styles.progressText, { color: colors.muted }]}>Прогресс</Text><Text style={[styles.progressText, { color: colors.text }]}>{progressPercent(questionIndex, quiz.questions.length)}%</Text></View>
		<ProgressBar value={progressPercent(questionIndex, quiz.questions.length)} />
		<Card style={styles.questionCard}><Text style={[styles.questionNumber, { color: colors.muted }]}>Вопрос {questionIndex + 1} · {question.type === 'multiple_choice' ? 'несколько ответов' : question.type === 'free_text' ? 'свободный ответ' : question.type === 'photo_answer' ? 'фото-ответ' : question.type === 'rating' ? 'оценка' : 'выбор ответа'}</Text><Text accessibilityRole="header" style={[styles.questionText, { color: colors.text }]}>{question.prompt}</Text>{question.description && <Text style={[styles.muted, { color: colors.muted }]}>{question.description}</Text>}</Card>
		{question.options.length > 0 && <View style={styles.options}>{question.options.map((option) => { const selected = selectedOptions.includes(option.id); return <Pressable key={option.id} accessibilityRole={question.type === 'multiple_choice' ? 'checkbox' : 'radio'} accessibilityState={{ selected }} onPress={() => select(option.id)} style={({ pressed }) => [styles.option, { backgroundColor: selected ? colors.accentSoft : colors.surfaceRaised, borderColor: selected ? colors.accent : colors.border, opacity: pressed ? 0.72 : 1 }]}><View style={[styles.radio, { borderColor: selected ? colors.accent : colors.muted, borderRadius: question.type === 'multiple_choice' ? 6 : 12, backgroundColor: selected ? colors.accent : 'transparent' }]}>{selected && <View style={[styles.radioDot, { backgroundColor: colors.onAccent }]} />}</View><Text style={[styles.optionText, { color: colors.text }]}>{option.label}</Text></Pressable> })}</View>}
		{question.type === 'free_text' && <TextInput multiline value={currentAnswer.textAnswer ?? ''} onChangeText={(text) => updateRichAnswer({ textAnswer: text })} placeholder="Введите ответ" placeholderTextColor={colors.muted} style={[styles.textInput, { color: colors.text, backgroundColor: colors.surfaceRaised, borderColor: colors.border }]} textAlignVertical="top" />}
		{question.type === 'rating' && <View style={styles.ratingList}>{Array.from({ length: Math.max(1, (Number(questionConfig.maximum ?? 5) - Number(questionConfig.minimum ?? 1)) + 1) }, (_, index) => Number(questionConfig.minimum ?? 1) + index).map((value) => { const selected = currentAnswer.rating === value; return <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => updateRichAnswer({ rating: value })} style={[styles.ratingOption, { backgroundColor: selected ? colors.accent : colors.surfaceRaised, borderColor: selected ? colors.accent : colors.border }]}><Text style={{ color: selected ? colors.onAccent : colors.text, fontSize: 17, fontWeight: '600' }}>{value}</Text></Pressable> })}</View>}
		{question.type === 'photo_answer' && <View style={styles.photoAnswer}><ActionButton label={currentAnswer.photoId ? 'Заменить фотографию' : 'Прикрепить фотографию'} icon={ImageIcon} variant="secondary" onPress={() => void pickPhoto()} disabled={submitting} />{currentAnswer.photoId && <Text style={[styles.muted, { color: colors.success }]}>Фотография прикреплена и будет проверена после отправки.</Text>}</View>}
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
	textInput: { minHeight: 150, borderWidth: 1, borderRadius: 16, padding: 16, fontSize: 16, lineHeight: 23 },
	ratingList: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
	ratingOption: { minWidth: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1 },
	photoAnswer: { gap: 10 },
	draftError: { fontSize: 13, lineHeight: 18 },
	navigation: { flexDirection: 'row', gap: 10, paddingTop: 2 },
	navButton: { flex: 1 },
	navSpacer: { flex: 1 },
})

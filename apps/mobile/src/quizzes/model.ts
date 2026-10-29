import type { QuizStaffResponse, SubmitAttemptInput } from '@vizaje/contracts'

export type RichAnswer = { optionIds?: string[]; textAnswer?: string | null; rating?: number | null; photoId?: string | null }
export type AnswerValue = string | string[] | RichAnswer | null
export type AnswerMap = Record<string, AnswerValue>

export function answerValue(value: AnswerValue): RichAnswer {
	if (typeof value === 'string') return { optionIds: [value] }
	if (Array.isArray(value)) return { optionIds: value }
	return value ?? {}
}

export function selectedOptionIds(value: AnswerValue): string[] {
	return answerValue(value).optionIds ?? []
}

export function hasAnswer(value: AnswerValue): boolean {
	const normalized = answerValue(value)
	return (normalized.optionIds?.length ?? 0) > 0 || Boolean(normalized.textAnswer?.trim()) || normalized.rating !== null && normalized.rating !== undefined || Boolean(normalized.photoId)
}

export function createAnswerMap(quiz: QuizStaffResponse, existing: AnswerMap = {}): AnswerMap {
	return Object.fromEntries(quiz.questions.map((question) => [question.id, existing[question.id] ?? null]))
}

export function selectAnswer(answers: AnswerMap, questionId: string, optionId: string): AnswerMap {
	return { ...answers, [questionId]: optionId }
}

export function unansweredCount(quiz: QuizStaffResponse, answers: AnswerMap): number {
	return quiz.questions.filter((question) => !hasAnswer(answers[question.id])).length
}

export function progressPercent(questionIndex: number, questionCount: number): number {
	if (questionCount <= 0) return 0
	return Math.round(((questionIndex + 1) / questionCount) * 100)
}

export function toSubmissionInput(quiz: QuizStaffResponse, answers: AnswerMap): SubmitAttemptInput {
	return {
		answers: quiz.questions.map((question) => {
			const value = answers[question.id] ?? null
			if (typeof value === 'string' || value === null) return { questionId: question.id, optionId: value }
			const normalized = answerValue(value)
			return { questionId: question.id, optionId: normalized.optionIds?.[0] ?? null, optionIds: normalized.optionIds ?? [], textAnswer: normalized.textAnswer ?? null, rating: normalized.rating ?? null, photoId: normalized.photoId ?? null }
		}),
	}
}

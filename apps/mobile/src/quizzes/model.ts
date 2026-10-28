import type { QuizStaffResponse, SubmitAttemptInput } from '@vizaje/contracts'

export type AnswerMap = Record<string, string | null>

export function createAnswerMap(quiz: QuizStaffResponse, existing: AnswerMap = {}): AnswerMap {
	return Object.fromEntries(quiz.questions.map((question) => [question.id, existing[question.id] ?? null]))
}

export function selectAnswer(answers: AnswerMap, questionId: string, optionId: string): AnswerMap {
	return { ...answers, [questionId]: optionId }
}

export function unansweredCount(quiz: QuizStaffResponse, answers: AnswerMap): number {
	return quiz.questions.filter((question) => !answers[question.id]).length
}

export function progressPercent(questionIndex: number, questionCount: number): number {
	if (questionCount <= 0) return 0
	return Math.round(((questionIndex + 1) / questionCount) * 100)
}

export function toSubmissionInput(quiz: QuizStaffResponse, answers: AnswerMap): SubmitAttemptInput {
	return {
		answers: quiz.questions.map((question) => ({
			questionId: question.id,
			optionId: answers[question.id] ?? null,
		})),
	}
}

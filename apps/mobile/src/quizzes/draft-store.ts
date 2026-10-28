import { submitAttemptInputSchema, type SubmitAttemptInput } from '@vizaje/contracts'
import type { AnswerMap } from './model'

const DRAFT_KEY_PREFIX = 'vizaje.quiz.draft.'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface DraftStorage {
	getItem(key: string): Promise<string | null>
	setItem(key: string, value: string): Promise<void>
	deleteItem(key: string): Promise<void>
}

export type AttemptDraft = {
	attemptId: string
	quizId: string
	revisionId: string
	answers: SubmitAttemptInput
	updatedAt: string
}

function draftKey(attemptId: string): string {
	return `${DRAFT_KEY_PREFIX}${attemptId}`
}

function decode(value: string | null): AttemptDraft | null {
	if (!value) return null
	try {
		const parsed: unknown = JSON.parse(value)
		if (typeof parsed !== 'object' || parsed === null || !('attemptId' in parsed) || !('quizId' in parsed) || !('revisionId' in parsed) || !('answers' in parsed) || !('updatedAt' in parsed)) return null
		if (typeof parsed.attemptId !== 'string' || typeof parsed.quizId !== 'string' || typeof parsed.revisionId !== 'string' || typeof parsed.updatedAt !== 'string') return null
		if (!UUID_PATTERN.test(parsed.attemptId) || !UUID_PATTERN.test(parsed.quizId) || !UUID_PATTERN.test(parsed.revisionId)) return null
		const answers = submitAttemptInputSchema.safeParse(parsed.answers)
		if (!answers.success) return null
		return { attemptId: parsed.attemptId, quizId: parsed.quizId, revisionId: parsed.revisionId, answers: answers.data, updatedAt: parsed.updatedAt }
	} catch {
		return null
	}
}

export function createAttemptDraftStore(storage: DraftStorage) {
	return {
		async load(attemptId: string, quizId: string, revisionId: string): Promise<AttemptDraft | null> {
			const draft = decode(await storage.getItem(draftKey(attemptId)))
			if (!draft || draft.attemptId !== attemptId || draft.quizId !== quizId || draft.revisionId !== revisionId) return null
			return draft
		},
		async save(attemptId: string, quizId: string, revisionId: string, answers: AnswerMap, questionIds: string[]): Promise<void> {
			const input: SubmitAttemptInput = { answers: questionIds.map((questionId) => ({ questionId, optionId: answers[questionId] ?? null })) }
			const validated = submitAttemptInputSchema.parse(input)
			await storage.setItem(draftKey(attemptId), JSON.stringify({ attemptId, quizId, revisionId, answers: validated, updatedAt: new Date().toISOString() }))
		},
		async clear(attemptId: string): Promise<void> {
			await storage.deleteItem(draftKey(attemptId))
		},
	}
}

export function answerMapFromDraft(draft: AttemptDraft | null): AnswerMap {
	if (!draft) return {}
	return Object.fromEntries(draft.answers.answers.map((answer) => [answer.questionId, answer.optionId]))
}

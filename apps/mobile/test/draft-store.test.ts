import { describe, expect, test } from 'bun:test'
import { createAttemptDraftStore, answerMapFromDraft, type DraftStorage } from '../src/quizzes/draft-store'

const attemptId = '11111111-1111-4111-8111-111111111111'
const quizId = '22222222-2222-4222-8222-222222222222'
const revisionId = '33333333-3333-4333-8333-333333333333'
const questionId = '44444444-4444-4444-8444-444444444444'
const optionId = '55555555-5555-4555-8555-555555555555'

class MemoryDraftStorage implements DraftStorage {
	value: string | null = null
	async getItem() { return this.value }
	async setItem(_key: string, value: string) { this.value = value }
	async deleteItem() { this.value = null }
}

describe('quiz answer drafts', () => {
	test('restores answers only for the same attempt revision', async () => {
		const store = createAttemptDraftStore(new MemoryDraftStorage())
		await store.save(attemptId, quizId, revisionId, { [questionId]: optionId }, [questionId])
		const draft = await store.load(attemptId, quizId, revisionId)
		expect(answerMapFromDraft(draft)).toEqual({ [questionId]: optionId })
		expect(await store.load(attemptId, quizId, '66666666-6666-4666-8666-666666666666')).toBeNull()
	})

	test('clears a submitted attempt draft', async () => {
		const storage = new MemoryDraftStorage()
		const store = createAttemptDraftStore(storage)
		await store.save(attemptId, quizId, revisionId, { [questionId]: null }, [questionId])
		await store.clear(attemptId)
		expect(await store.load(attemptId, quizId, revisionId)).toBeNull()
	})
})

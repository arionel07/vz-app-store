import { describe, expect, test } from 'bun:test'
import { createAnswerMap, progressPercent, selectAnswer, toSubmissionInput, unansweredCount } from '../src/quizzes/model'
import type { QuizStaffResponse } from '@vizaje/contracts'

const quiz: QuizStaffResponse = {
	id: '11111111-1111-4111-8111-111111111111', revisionId: '22222222-2222-4222-8222-222222222222', revisionNumber: 3,
	title: 'Тест', description: 'Описание', passingScore: 70,
	questions: [
		{ id: '33333333-3333-4333-8333-333333333333', prompt: 'Первый вопрос', position: 0, options: [{ id: '44444444-4444-4444-8444-444444444444', label: 'Да', position: 0 }, { id: '55555555-5555-4555-8555-555555555555', label: 'Нет', position: 1 }] },
		{ id: '66666666-6666-4666-8666-666666666666', prompt: 'Второй вопрос', position: 1, options: [{ id: '77777777-7777-4777-8777-777777777777', label: 'Вариант', position: 0 }] },
	],
}

describe('quiz taking model', () => {
	test('initializes, selects and serializes one answer per question', () => {
		const initial = createAnswerMap(quiz)
		expect(unansweredCount(quiz, initial)).toBe(2)
		const selected = selectAnswer(initial, quiz.questions[0].id, quiz.questions[0].options[1].id)
		expect(unansweredCount(quiz, selected)).toBe(1)
		expect(toSubmissionInput(quiz, selected).answers).toEqual([
			{ questionId: quiz.questions[0].id, optionId: quiz.questions[0].options[1].id },
			{ questionId: quiz.questions[1].id, optionId: null },
		])
	})

	test('calculates bounded question progress', () => {
		expect(progressPercent(0, 2)).toBe(50)
		expect(progressPercent(1, 2)).toBe(100)
		expect(progressPercent(0, 0)).toBe(0)
	})

	test('serializes multiple choice, text and rating answers', () => {
		const richQuiz = { ...quiz, questions: [{ ...quiz.questions[0], type: 'multiple_choice' as const }, { ...quiz.questions[1], type: 'free_text' as const }] }
		const input = toSubmissionInput(richQuiz, { [richQuiz.questions[0].id]: [richQuiz.questions[0].options[0].id, richQuiz.questions[0].options[1].id], [richQuiz.questions[1].id]: { textAnswer: 'Ответ' } })
		expect(input.answers[0]).toMatchObject({ optionIds: [richQuiz.questions[0].options[0].id, richQuiz.questions[0].options[1].id] })
		expect(input.answers[1]).toMatchObject({ textAnswer: 'Ответ', optionIds: [] })
	})
})

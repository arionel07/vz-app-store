import { describe, expect, test } from "bun:test";
import { aggregateScores, scoreQuestion } from "../src/domain/quizzes/scoring";

const option = (id: string, isCorrect: boolean, points = 0) => ({ id, isCorrect, points });
const answer = (questionId: string, optionIds: string[] = []) => ({ questionId, optionId: optionIds[0] ?? null, optionIds, textAnswer: null, rating: null, photoId: null });

describe("advanced quiz scoring", () => {
  test("awards all-or-nothing points for a single choice", () => {
    const question = { type: "single_choice" as const, maxPoints: 5, scoringPolicy: "all_or_nothing" as const, config: {} };
    expect(scoreQuestion(question, [option("correct", true), option("wrong", false)], answer("q", ["correct"]))).toMatchObject({ earnedPoints: 5, maxPoints: 5, requiresReview: false });
    expect(scoreQuestion(question, [option("correct", true), option("wrong", false)], answer("q", ["wrong"]))).toMatchObject({ earnedPoints: 0 });
  });

  test("uses the documented partial credit formula and clamps penalties", () => {
    const question = { type: "multiple_choice" as const, maxPoints: 10, scoringPolicy: "partial_credit" as const, config: {} };
    const options = [option("a", true), option("b", true), option("c", false), option("d", false)];
    expect(scoreQuestion(question, options, answer("q", ["a"])).earnedPoints).toBe(5);
    expect(scoreQuestion(question, options, answer("q", ["a", "c", "d"])).earnedPoints).toBe(0);
  });

  test("keeps free text and photo answers pending manual review", () => {
    const score = scoreQuestion({ type: "free_text", maxPoints: 4, scoringPolicy: "all_or_nothing", config: {} }, [], answer("q"));
    expect(score).toEqual({ earnedPoints: null, maxPoints: 4, requiresReview: true });
    expect(aggregateScores([score])).toMatchObject({ earnedPoints: null, scorePercent: null, requiresReview: true });
  });

  test("does not score surveys", () => {
    const score = scoreQuestion({ type: "opinion", maxPoints: 1, scoringPolicy: "all_or_nothing", config: {} }, [option("a", false)], answer("q", ["a"]));
    expect(aggregateScores([score])).toMatchObject({ earnedPoints: 0, maxPoints: 0, scorePercent: 0, requiresReview: false });
  });
});

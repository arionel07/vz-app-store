import type { QuizQuestionType, QuizScoringPolicy, SubmitAttemptData } from "@vizaje/contracts";

export interface ScoringQuestion {
  type: QuizQuestionType;
  maxPoints: number;
  scoringPolicy: QuizScoringPolicy;
  config: Record<string, unknown>;
}

export interface ScoringOption {
  id: string;
  isCorrect: boolean;
  points: number;
}

export interface QuestionScore {
  earnedPoints: number | null;
  maxPoints: number;
  requiresReview: boolean;
}

function selectedIds(answer: SubmitAttemptData["answers"][number]): string[] {
  return answer.optionIds.length > 0 ? [...new Set(answer.optionIds)] : answer.optionId ? [answer.optionId] : [];
}

function choiceScore(question: ScoringQuestion, options: ScoringOption[], answer: SubmitAttemptData["answers"][number], allowMultiple: boolean): QuestionScore {
  const selected = selectedIds(answer);
  if (!allowMultiple && selected.length > 1) return { earnedPoints: 0, maxPoints: question.maxPoints, requiresReview: false };
  const correct = new Set(options.filter((option) => option.isCorrect).map((option) => option.id));
  const wrongSelected = selected.filter((id) => !correct.has(id));
  const correctSelected = selected.filter((id) => correct.has(id));
  if (question.scoringPolicy === "partial_credit" && allowMultiple) {
    const correctPart = correct.size === 0 ? 0 : Math.floor((question.maxPoints * correctSelected.length) / correct.size);
    const wrongOptions = Math.max(1, options.length - correct.size);
    const penalty = Math.ceil((question.maxPoints * wrongSelected.length) / wrongOptions);
    return { earnedPoints: Math.max(0, Math.min(question.maxPoints, correctPart - penalty)), maxPoints: question.maxPoints, requiresReview: false };
  }
  const exact = selected.length === correct.size && correctSelected.length === correct.size && wrongSelected.length === 0;
  return { earnedPoints: exact ? question.maxPoints : 0, maxPoints: question.maxPoints, requiresReview: false };
}

export function scoreQuestion(question: ScoringQuestion, options: ScoringOption[], answer: SubmitAttemptData["answers"][number]): QuestionScore {
  if (question.type === "free_text" || question.type === "photo_answer") return { earnedPoints: null, maxPoints: question.maxPoints, requiresReview: true };
  if (question.type === "opinion") return { earnedPoints: 0, maxPoints: 0, requiresReview: false };
  if (question.type === "rating") {
    if (question.config.scored !== true || answer.rating === null) return { earnedPoints: 0, maxPoints: 0, requiresReview: false };
    const minimum = typeof question.config.minimum === "number" ? question.config.minimum : 1;
    const maximum = typeof question.config.maximum === "number" ? question.config.maximum : 5;
    if (maximum <= minimum || answer.rating < minimum || answer.rating > maximum) return { earnedPoints: 0, maxPoints: 0, requiresReview: false };
    return { earnedPoints: Math.floor((question.maxPoints * (answer.rating - minimum)) / (maximum - minimum)), maxPoints: question.maxPoints, requiresReview: false };
  }
  if (question.type === "weighted_choice") {
    const option = options.find((candidate) => candidate.id === selectedIds(answer)[0]);
    return { earnedPoints: option ? Math.max(0, Math.min(question.maxPoints, option.points)) : 0, maxPoints: question.maxPoints, requiresReview: false };
  }
  if (question.type === "multiple_choice") return choiceScore(question, options, answer, true);
  if (question.type === "scenario") {
    const scenarioMode = question.config.selectionMode === "multiple";
    return choiceScore(question, options, answer, scenarioMode);
  }
  return choiceScore(question, options, answer, false);
}

export function aggregateScores(scores: QuestionScore[]): { earnedPoints: number | null; maxPoints: number; requiresReview: boolean; scorePercent: number | null } {
  const requiresReview = scores.some((score) => score.requiresReview && score.earnedPoints === null);
  const maxPoints = scores.reduce((total, score) => total + score.maxPoints, 0);
  const earnedPoints = scores.reduce<number | null>((total, score) => total === null || score.earnedPoints === null ? null : total + score.earnedPoints, 0);
  return {
    earnedPoints,
    maxPoints,
    requiresReview,
    scorePercent: earnedPoints === null || maxPoints === 0 ? (requiresReview ? null : 0) : Math.floor((earnedPoints * 100) / maxPoints),
  };
}

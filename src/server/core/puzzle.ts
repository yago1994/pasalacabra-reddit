import { redis } from '@devvit/web/server';
import type { ClientQuestion, QA } from '../../shared/letters';
import { gameNoForDate } from '../../shared/dailyIssue';
import { QUESTION_SETS } from '../data/sets';
import { puzzleKey, PUZZLE_TTL_SECONDS } from './redisKeys';

export type Puzzle = { date: string; gameNo: number; questions: QA[] };

/**
 * Deterministic daily rotation over the bundled sets. Stored in Redis so the
 * puzzle for a date is frozen even if the bundle changes in a later version.
 */
export async function getOrCreatePuzzle(date: string): Promise<Puzzle> {
  const key = puzzleKey(date);
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as Puzzle;

  const gameNo = gameNoForDate(new Date(`${date}T00:00:00Z`));
  const set = QUESTION_SETS[(gameNo - 1) % QUESTION_SETS.length]!;
  const puzzle: Puzzle = { date, gameNo, questions: set.questions };

  await redis.set(key, JSON.stringify(puzzle));
  await redis.expire(key, PUZZLE_TTL_SECONDS);
  return puzzle;
}

/** Strip answers before anything leaves the server. */
export function toClientQuestions(questions: QA[]): ClientQuestion[] {
  return questions.map(({ letter, mode, question }) => ({ letter, mode, question }));
}

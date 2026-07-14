import { redis } from '@devvit/web/server';
import type { ClientQuestion, QA } from '../../shared/letters';
import { gameNoForDate } from '../../shared/dailyIssue';
import { QUESTION_SETS } from '../data/sets';
import { DAILY_SETS } from '../data/daily';
import { fetchDailySet, getDailySetsBaseUrl } from './dailySetFetcher';
import { puzzleKey, PUZZLE_TTL_SECONDS } from './redisKeys';

export type Puzzle = { date: string; gameNo: number; questions: QA[] };

/**
 * Resolve the day's puzzle and freeze it in Redis so it stays fixed even if the
 * source changes later.
 *
 * Resolution order:
 * - A date-keyed set bundled with the app (`data/daily`) wins if present. This
 *   is a stopgap for serving specific days without the `http` permission while
 *   the remote fetch domain is pending approval.
 * - Otherwise, when `daily-sets-base-url` is configured, fetch that date's
 *   pre-generated set from remote. A missing/invalid file throws — we do NOT
 *   fall back to a static set, so a failed generation surfaces loudly rather
 *   than silently serving stale/repeated content.
 * - Otherwise (dev, no base URL), rotate the bundled static sets deterministically.
 */
export async function getOrCreatePuzzle(date: string): Promise<Puzzle> {
  const key = puzzleKey(date);
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as Puzzle;

  const gameNo = gameNoForDate(new Date(`${date}T00:00:00Z`));
  const bundledForDate = DAILY_SETS[date];
  const baseUrl = await getDailySetsBaseUrl();

  const questions = bundledForDate
    ? bundledForDate.questions
    : baseUrl
      ? (await fetchDailySet(baseUrl, date)).questions
      : QUESTION_SETS[(gameNo - 1) % QUESTION_SETS.length]!.questions;

  const puzzle: Puzzle = { date, gameNo, questions };

  await redis.set(key, JSON.stringify(puzzle));
  await redis.expire(key, PUZZLE_TTL_SECONDS);
  return puzzle;
}

/** Strip answers before anything leaves the server. */
export function toClientQuestions(questions: QA[]): ClientQuestion[] {
  return questions.map(({ letter, mode, question }) => ({ letter, mode, question }));
}

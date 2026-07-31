import { redis } from '@devvit/web/server';
import {
  LETTERS,
  MAX_STALL_CREDIT_PER_ACTION_MS,
  MAX_STALL_CREDIT_TOTAL_MS,
  REVEAL_PAUSE_MS,
  TURN_SECONDS,
  type Letter,
  type StatusByLetter,
} from '../../shared/letters';
import {
  anyUnresolved,
  countStatuses,
  createInitialGameState,
  reduceTurn,
  type GameState,
} from '../../shared/engine';
import { isAnswerCorrect } from '../../shared/normalize';
import { buildShareText } from '../../shared/shareRing';
import type { GameResult } from '../../shared/api';
import type { Puzzle } from './puzzle';
import { gameKey, GAME_TTL_SECONDS } from './redisKeys';
import { recordScore, getRank } from './leaderboard';
import { updateStreak, getStreak } from './streak';

/** Extra seconds of slack for network latency before rejecting actions. */
const GRACE_SECONDS = 10;
/** Minimum ms between guesses; a human reading a clue can't answer faster. */
const MIN_ACTION_INTERVAL_MS = 500;

export type StoredGame = {
  state: GameState;
  startedAt: number;
  finishedAt?: number;
  lastActionAt: number;
  /** Turn length for this game — normally TURN_SECONDS, shorter in test mode. */
  turnSeconds: number;
  /**
   * Accumulated time the player was locked out waiting on the network, credited
   * back to the clock so a slow connection doesn't eat the turn.
   */
  creditedMs: number;
};

async function saveGame(date: string, userId: string, game: StoredGame): Promise<void> {
  const key = gameKey(date, userId);
  await redis.hSet(key, {
    state: JSON.stringify(game.state),
    startedAt: String(game.startedAt),
    finishedAt: game.finishedAt ? String(game.finishedAt) : '',
    lastActionAt: String(game.lastActionAt),
    turnSeconds: String(game.turnSeconds),
    creditedMs: String(game.creditedMs),
  });
  await redis.expire(key, GAME_TTL_SECONDS);
}

export async function loadGame(date: string, userId: string): Promise<StoredGame | null> {
  const raw = await redis.hGetAll(gameKey(date, userId));
  if (!raw || !raw.state) return null;
  const game: StoredGame = {
    state: JSON.parse(raw.state) as GameState,
    startedAt: Number(raw.startedAt),
    lastActionAt: Number(raw.lastActionAt ?? raw.startedAt),
    turnSeconds: raw.turnSeconds ? Number(raw.turnSeconds) : TURN_SECONDS,
    // Absent on games stored before credits existed.
    creditedMs: raw.creditedMs ? Number(raw.creditedMs) : 0,
  };
  if (raw.finishedAt) game.finishedAt = Number(raw.finishedAt);
  return game;
}

/**
 * The turn's real deadline. The nominal turn length, plus the two kinds of time
 * the player couldn't play through: the wrong-answer reveal (server-computed,
 * one per wrong letter) and network stalls (client-reported, see creditStall).
 */
function allowedSeconds(game: StoredGame): number {
  const { wrong } = countStatuses(game.state.statusByLetter);
  return game.turnSeconds + (wrong * REVEAL_PAUSE_MS) / 1000 + game.creditedMs / 1000;
}

/**
 * Credit time the client reports being locked out for. Only the client can
 * measure its own round trip, so the figure is bounded three ways: per action,
 * in total across the game, and by the wall-clock gap since the last action —
 * a report can never claim more time than actually elapsed.
 */
function creditStall(game: StoredGame, reportedMs: number | undefined, now: number): void {
  if (typeof reportedMs !== 'number' || !Number.isFinite(reportedMs) || reportedMs <= 0) return;
  const gap = Math.max(0, now - game.lastActionAt);
  const room = Math.max(0, MAX_STALL_CREDIT_TOTAL_MS - game.creditedMs);
  game.creditedMs += Math.min(reportedMs, MAX_STALL_CREDIT_PER_ACTION_MS, gap, room);
}

export function secondsLeft(game: StoredGame, now: number = Date.now()): number {
  const elapsed = (now - game.startedAt) / 1000;
  return Math.max(0, Math.min(game.turnSeconds, Math.ceil(allowedSeconds(game) - elapsed)));
}

export async function startGame(
  date: string,
  userId: string,
  turnSeconds: number = TURN_SECONDS
): Promise<StoredGame> {
  const existing = await loadGame(date, userId);
  if (existing) return existing; // idempotent; also blocks restarts

  const now = Date.now();
  const game: StoredGame = {
    state: createInitialGameState(),
    startedAt: now,
    lastActionAt: now,
    turnSeconds,
    creditedMs: 0,
  };
  await saveGame(date, userId, game);
  return game;
}

export type ActionOutcome =
  | { kind: 'rejected'; reason: string }
  | { kind: 'timeout'; game: StoredGame }
  | {
      kind: 'ok';
      game: StoredGame;
      verdict?: 'correct' | 'wrong';
      correctAnswer?: string;
      finished: boolean;
    };

export async function applyAction(
  date: string,
  userId: string,
  puzzle: Puzzle,
  action: { type: 'guess'; letter: string; answer: string } | { type: 'pass'; letter: string },
  stalledMs?: number
): Promise<ActionOutcome> {
  const game = await loadGame(date, userId);
  if (!game) return { kind: 'rejected', reason: 'Game not started' };
  if (game.finishedAt) return { kind: 'rejected', reason: 'Game already finished' };

  const now = Date.now();
  // Credit before the deadline check, so a stall can't be what ends the game.
  creditStall(game, stalledMs, now);
  const elapsed = (now - game.startedAt) / 1000;
  if (elapsed > allowedSeconds(game) + GRACE_SECONDS) {
    game.finishedAt = now;
    await saveGame(date, userId, game);
    return { kind: 'timeout', game };
  }
  if (now - game.lastActionAt < MIN_ACTION_INTERVAL_MS) {
    return { kind: 'rejected', reason: 'Too fast' };
  }

  const currentLetter = LETTERS[game.state.currentIndex]!;
  if (action.letter !== currentLetter) {
    return { kind: 'rejected', reason: `Current letter is ${currentLetter}` };
  }

  let verdict: 'correct' | 'wrong' | undefined;
  let correctAnswer: string | undefined;

  if (action.type === 'guess') {
    const qa = puzzle.questions.find((q) => q.letter === currentLetter);
    if (!qa) return { kind: 'rejected', reason: 'Question not found' };
    const correct = isAnswerCorrect(action.answer, qa.answer, qa.alt);
    verdict = correct ? 'correct' : 'wrong';
    if (!correct) correctAnswer = qa.answer;
    game.state = reduceTurn(game.state, { type: verdict });
  } else {
    game.state = reduceTurn(game.state, { type: 'pass' });
  }

  game.lastActionAt = now;
  const finished = !anyUnresolved(game.state.statusByLetter);
  if (finished) game.finishedAt = now;
  await saveGame(date, userId, game);

  const outcome: ActionOutcome = { kind: 'ok', game, finished };
  if (verdict) outcome.verdict = verdict;
  if (correctAnswer !== undefined) outcome.correctAnswer = correctAnswer;
  return outcome;
}

/**
 * Time the player actually spent playing — the leaderboard's tiebreaker, so it
 * has to exclude everything they couldn't play through, exactly as
 * `allowedSeconds` does. Otherwise a laggy connection would rank worse.
 */
export function timeUsedSeconds(game: StoredGame): number {
  const end = game.finishedAt ?? Date.now();
  const { wrong } = countStatuses(game.state.statusByLetter);
  const played =
    (end - game.startedAt) / 1000 - (wrong * REVEAL_PAUSE_MS) / 1000 - game.creditedMs / 1000;
  return Math.max(0, Math.min(game.turnSeconds, Math.round(played)));
}

/**
 * Finalize a game: mark finished, record score/streak (today's puzzle only),
 * and build the result payload. Idempotent.
 */
export async function finishGame(params: {
  date: string;
  userId: string;
  username: string;
  puzzle: Puzzle;
  isToday: boolean;
  game?: StoredGame;
}): Promise<GameResult | null> {
  const { date, userId, username, puzzle, isToday } = params;
  const game = params.game ?? (await loadGame(date, userId));
  if (!game) return null;

  const alreadyFinished = Boolean(game.finishedAt);
  if (!alreadyFinished) {
    game.finishedAt = Date.now();
    await saveGame(date, userId, game);
  }

  // Resolve any still-current letter status for display.
  const statusByLetter: StatusByLetter = { ...game.state.statusByLetter };
  for (const l of LETTERS) {
    if (statusByLetter[l] === 'current') statusByLetter[l] = 'passed';
  }

  const { correct, wrong } = countStatuses(statusByLetter);
  const timeUsed = timeUsedSeconds(game);

  if (isToday) {
    await recordScore({ date, userId, username, correct, wrong, timeUsed });
  }
  const streak = isToday ? await updateStreak(userId, date) : await getStreak(userId);
  const rank = await getRank(date, userId);

  const answers = LETTERS.map((letter) => {
    const qa = puzzle.questions.find((q) => q.letter === letter);
    return {
      letter,
      mode: qa?.mode ?? ('starts' as const),
      question: qa?.question ?? '',
      answer: qa?.answer ?? '',
      status: statusByLetter[letter],
    };
  });

  return {
    correct,
    wrong,
    timeUsedSeconds: timeUsed,
    rank: rank.rank,
    totalPlayers: rank.totalPlayers,
    streak: streak.streak,
    maxStreak: streak.maxStreak,
    shareText: buildShareText(statusByLetter, puzzle.gameNo, timeUsed),
    statusByLetter,
    answers,
  };
}

export function isValidLetter(letter: string): letter is Letter {
  return (LETTERS as readonly string[]).includes(letter);
}

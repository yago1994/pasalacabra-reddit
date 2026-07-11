import { redis } from '@devvit/web/server';
import {
  LETTERS,
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
};

async function saveGame(date: string, userId: string, game: StoredGame): Promise<void> {
  const key = gameKey(date, userId);
  await redis.hSet(key, {
    state: JSON.stringify(game.state),
    startedAt: String(game.startedAt),
    finishedAt: game.finishedAt ? String(game.finishedAt) : '',
    lastActionAt: String(game.lastActionAt),
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
  };
  if (raw.finishedAt) game.finishedAt = Number(raw.finishedAt);
  return game;
}

/** Wrong answers pause the client for the reveal; extend the allowance to match. */
function allowedSeconds(state: GameState): number {
  const { wrong } = countStatuses(state.statusByLetter);
  return TURN_SECONDS + (wrong * REVEAL_PAUSE_MS) / 1000;
}

export function secondsLeft(game: StoredGame, now: number = Date.now()): number {
  const elapsed = (now - game.startedAt) / 1000;
  return Math.max(0, Math.min(TURN_SECONDS, Math.ceil(allowedSeconds(game.state) - elapsed)));
}

export async function startGame(date: string, userId: string): Promise<StoredGame> {
  const existing = await loadGame(date, userId);
  if (existing) return existing; // idempotent; also blocks restarts

  const now = Date.now();
  const game: StoredGame = { state: createInitialGameState(), startedAt: now, lastActionAt: now };
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
  action: { type: 'guess'; letter: string; answer: string } | { type: 'pass'; letter: string }
): Promise<ActionOutcome> {
  const game = await loadGame(date, userId);
  if (!game) return { kind: 'rejected', reason: 'Game not started' };
  if (game.finishedAt) return { kind: 'rejected', reason: 'Game already finished' };

  const now = Date.now();
  const elapsed = (now - game.startedAt) / 1000;
  if (elapsed > allowedSeconds(game.state) + GRACE_SECONDS) {
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

export function timeUsedSeconds(game: StoredGame): number {
  const end = game.finishedAt ?? Date.now();
  const { wrong } = countStatuses(game.state.statusByLetter);
  const played = (end - game.startedAt) / 1000 - (wrong * REVEAL_PAUSE_MS) / 1000;
  return Math.max(0, Math.min(TURN_SECONDS, Math.round(played)));
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

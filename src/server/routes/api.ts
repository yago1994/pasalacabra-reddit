import { Hono } from 'hono';
import { context, media, reddit, RichTextBuilder } from '@devvit/web/server';
import type {
  ApiError,
  FinishRequest,
  FinishResponse,
  GuessRequest,
  GuessResponse,
  InitResponse,
  LeaderboardResponse,
  PassRequest,
  PassResponse,
  PrefsRequest,
  PrefsResponse,
  ShareRequest,
  ShareResponse,
  StartResponse,
} from '../../shared/api';
import { utcDateKey } from '../../shared/dailyIssue';
import { TURN_SECONDS } from '../../shared/letters';
import { getOrCreatePuzzle, toClientQuestions } from '../core/puzzle';
import { dateForPost } from '../core/post';
import {
  applyAction,
  finishGame,
  isValidLetter,
  loadGame,
  secondsLeft,
  startGame,
} from '../core/game';
import { getLeaderboard } from '../core/leaderboard';
import { getMuted, getStreak, getTestMode, setMuted } from '../core/streak';

/** Short timer used when a moderator enables test mode, to reach results fast. */
const TEST_TURN_SECONDS = 10;

export const api = new Hono();

type Session = {
  date: string;
  isToday: boolean;
  userId: string;
  username: string;
};

async function getSession(): Promise<Session | { error: string }> {
  const { postId, userId } = context;
  if (!postId) return { error: 'postId missing from context' };
  if (!userId) return { error: 'Log in to Reddit to play' };
  const [date, username] = await Promise.all([
    dateForPost(postId),
    reddit.getCurrentUsername(),
  ]);
  return {
    date,
    isToday: date === utcDateKey(),
    userId,
    username: username ?? 'anonymous',
  };
}

api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<ApiError>({ status: 'error', message: 'postId missing' }, 400);

  const date = await dateForPost(postId);
  const isToday = date === utcDateKey();
  const puzzle = await getOrCreatePuzzle(date);
  const userId = context.userId ?? null;
  const username = userId ? ((await reddit.getCurrentUsername()) ?? null) : null;

  const leaderboard = await getLeaderboard(date, userId);

  const base: InitResponse = {
    type: 'init',
    date,
    gameNo: puzzle.gameNo,
    isToday,
    username,
    status: 'not_started',
    leaderboard,
    muted: userId ? await getMuted(userId) : false,
  };

  if (userId) {
    const game = await loadGame(date, userId);
    if (game) {
      if (game.finishedAt) {
        base.status = 'finished';
        const result = await finishGame({
          date,
          userId,
          username: username ?? 'anonymous',
          puzzle,
          isToday,
          game,
        });
        if (result) base.result = result;
      } else if (secondsLeft(game) <= 0) {
        base.status = 'finished';
        const result = await finishGame({
          date,
          userId,
          username: username ?? 'anonymous',
          puzzle,
          isToday,
          game,
        });
        if (result) base.result = result;
      } else {
        base.status = 'in_progress';
        base.game = {
          questions: toClientQuestions(puzzle.questions),
          statusByLetter: game.state.statusByLetter,
          currentIndex: game.state.currentIndex,
          secondsLeft: secondsLeft(game),
        };
      }
    }
  }

  return c.json<InitResponse>(base);
});

api.post('/game/start', async (c) => {
  const session = await getSession();
  if ('error' in session) return c.json<ApiError>({ status: 'error', message: session.error }, 400);

  const puzzle = await getOrCreatePuzzle(session.date);
  const testMode = await getTestMode(session.userId);
  const game = await startGame(session.date, session.userId, testMode ? TEST_TURN_SECONDS : TURN_SECONDS);
  if (game.finishedAt) {
    return c.json<ApiError>({ status: 'error', message: 'Game already finished' }, 400);
  }

  return c.json<StartResponse>({
    type: 'start',
    questions: toClientQuestions(puzzle.questions),
    statusByLetter: game.state.statusByLetter,
    currentIndex: game.state.currentIndex,
    secondsLeft: secondsLeft(game) || TURN_SECONDS,
  });
});

api.post('/game/guess', async (c) => {
  const session = await getSession();
  if ('error' in session) return c.json<ApiError>({ status: 'error', message: session.error }, 400);

  const body = await c.req.json<GuessRequest>();
  if (!isValidLetter(body.letter) || typeof body.answer !== 'string' || body.answer.length > 100) {
    return c.json<ApiError>({ status: 'error', message: 'Invalid guess' }, 400);
  }

  const puzzle = await getOrCreatePuzzle(session.date);
  const outcome = await applyAction(session.date, session.userId, puzzle, {
    type: 'guess',
    letter: body.letter,
    answer: body.answer,
  });

  if (outcome.kind === 'rejected') {
    return c.json<ApiError>({ status: 'error', message: outcome.reason }, 400);
  }

  if (outcome.kind === 'timeout') {
    const result = await finishGame({ ...sessionArgs(session), puzzle, game: outcome.game });
    return c.json<GuessResponse>({
      type: 'guess',
      verdict: 'wrong',
      statusByLetter: outcome.game.state.statusByLetter,
      currentIndex: outcome.game.state.currentIndex,
      secondsLeft: 0,
      finished: true,
      ...(result ? { result } : {}),
    });
  }

  const response: GuessResponse = {
    type: 'guess',
    verdict: outcome.verdict ?? 'wrong',
    statusByLetter: outcome.game.state.statusByLetter,
    currentIndex: outcome.game.state.currentIndex,
    secondsLeft: secondsLeft(outcome.game),
    finished: outcome.finished,
  };
  if (outcome.correctAnswer !== undefined) response.correctAnswer = outcome.correctAnswer;

  if (outcome.finished) {
    const result = await finishGame({ ...sessionArgs(session), puzzle, game: outcome.game });
    if (result) response.result = result;
  }

  return c.json<GuessResponse>(response);
});

api.post('/game/pass', async (c) => {
  const session = await getSession();
  if ('error' in session) return c.json<ApiError>({ status: 'error', message: session.error }, 400);

  const body = await c.req.json<PassRequest>();
  if (!isValidLetter(body.letter)) {
    return c.json<ApiError>({ status: 'error', message: 'Invalid letter' }, 400);
  }

  const puzzle = await getOrCreatePuzzle(session.date);
  const outcome = await applyAction(session.date, session.userId, puzzle, {
    type: 'pass',
    letter: body.letter,
  });

  if (outcome.kind === 'rejected') {
    return c.json<ApiError>({ status: 'error', message: outcome.reason }, 400);
  }
  if (outcome.kind === 'timeout') {
    await finishGame({ ...sessionArgs(session), puzzle, game: outcome.game });
    return c.json<PassResponse>({
      type: 'pass',
      statusByLetter: outcome.game.state.statusByLetter,
      currentIndex: outcome.game.state.currentIndex,
      secondsLeft: 0,
    });
  }

  return c.json<PassResponse>({
    type: 'pass',
    statusByLetter: outcome.game.state.statusByLetter,
    currentIndex: outcome.game.state.currentIndex,
    secondsLeft: secondsLeft(outcome.game),
  });
});

api.post('/game/finish', async (c) => {
  const session = await getSession();
  if ('error' in session) return c.json<ApiError>({ status: 'error', message: session.error }, 400);

  const body = await c.req.json<FinishRequest>().catch(() => ({ reason: 'timeout' }) as FinishRequest);
  void body; // reason is informational; the server trusts its own clock

  const puzzle = await getOrCreatePuzzle(session.date);
  const result = await finishGame({ ...sessionArgs(session), puzzle });
  if (!result) return c.json<ApiError>({ status: 'error', message: 'No game to finish' }, 400);

  return c.json<FinishResponse>({ type: 'finish', result });
});

api.get('/leaderboard', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<ApiError>({ status: 'error', message: 'postId missing' }, 400);
  const date = await dateForPost(postId);
  const leaderboard = await getLeaderboard(date, context.userId ?? null);
  return c.json<LeaderboardResponse>({ type: 'leaderboard', leaderboard });
});

api.post('/share', async (c) => {
  const session = await getSession();
  if ('error' in session) return c.json<ApiError>({ status: 'error', message: session.error }, 400);

  const puzzle = await getOrCreatePuzzle(session.date);
  const game = await loadGame(session.date, session.userId);
  if (!game?.finishedAt) {
    return c.json<ApiError>({ status: 'error', message: 'Finish the game first' }, 400);
  }

  const result = await finishGame({ ...sessionArgs(session), puzzle, game });
  if (!result) return c.json<ApiError>({ status: 'error', message: 'No result' }, 400);

  const body = await c.req.json<ShareRequest>().catch(() => ({}) as ShareRequest);
  const skip = 26 - result.correct - result.wrong;
  const t = result.timeUsedSeconds;
  const time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const caption = `Pasala🐐 #${puzzle.gameNo} — 🟢 ${result.correct} · 🔴 ${result.wrong} · 🔵 ${skip} · ⏱️ ${time}`;

  let posted = false;
  try {
    if (body.imageDataUrl && body.imageDataUrl.startsWith('data:image/')) {
      // Upload the client-rendered results card and embed it in the comment,
      // so the shared artifact carries the real visual, not just emoji.
      const uploaded = await media.upload({ url: body.imageDataUrl, type: 'image' });
      const richtext = new RichTextBuilder()
        .image({ mediaUrl: uploaded.mediaUrl })
        .paragraph((p) => p.text({ text: caption }));
      await reddit.submitComment({ id: context.postId!, richtext, runAs: 'USER' });
    } else {
      // Fallback: emoji text comment (e.g. if the client couldn't render a PNG).
      await reddit.submitComment({ id: context.postId!, text: result.shareText, runAs: 'USER' });
    }
    posted = true;
  } catch (error) {
    console.error('share comment failed:', error);
  }

  return c.json<ShareResponse>({ type: 'share', posted, shareText: result.shareText });
});

api.post('/prefs', async (c) => {
  const session = await getSession();
  if ('error' in session) return c.json<ApiError>({ status: 'error', message: session.error }, 400);
  const body = await c.req.json<PrefsRequest>();
  await setMuted(session.userId, Boolean(body.muted));
  return c.json<PrefsResponse>({ type: 'prefs', muted: Boolean(body.muted) });
});

api.get('/streak', async (c) => {
  if (!context.userId) return c.json({ streak: 0, maxStreak: 0 });
  return c.json(await getStreak(context.userId));
});

function sessionArgs(session: Session): {
  date: string;
  userId: string;
  username: string;
  isToday: boolean;
} {
  return {
    date: session.date,
    userId: session.userId,
    username: session.username,
    isToday: session.isToday,
  };
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LETTERS, type ClientQuestion, type StatusByLetter } from '../../shared/letters';
import { createInitialStatusByLetter } from '../../shared/engine';
import type {
  FinishResponse,
  GameResult,
  GuessResponse,
  InitResponse,
  LeaderboardView,
  PassResponse,
  ShareResponse,
  StartResponse,
} from '../../shared/api';

export type Phase = 'loading' | 'error' | 'intro' | 'playing' | 'finished';

export type Feedback =
  | { kind: 'correct' }
  | { kind: 'wrong'; correctAnswer: string }
  | { kind: 'passed' };

type GameData = {
  phase: Phase;
  errorMessage: string;
  date: string;
  gameNo: number;
  isToday: boolean;
  username: string | null;
  questions: ClientQuestion[];
  statusByLetter: StatusByLetter;
  currentIndex: number;
  secondsLeft: number;
  feedback: Feedback | null;
  /** True while the wrong-answer reveal is being read aloud — suppresses the
   * next-question announcement until it finishes. */
  revealing: boolean;
  result: GameResult | null;
  leaderboard: LeaderboardView;
  muted: boolean;
  submitting: boolean;
};

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json()) as T & { status?: string; message?: string };
  if (!res.ok || data.status === 'error') {
    throw new Error(data.message ?? `HTTP ${res.status}`);
  }
  return data;
}

export function useGame(callbacks: {
  onCorrect: () => void;
  /** Plays the wrong SFX and reads the correct answer aloud; resolves when the
   * reveal is done (speech finished, or a fallback pause if TTS is unavailable). */
  onWrong: (correctAnswer: string) => Promise<void>;
  onPass: () => void;
  onQuestion: (question: ClientQuestion) => void;
}) {
  const [data, setData] = useState<GameData>({
    phase: 'loading',
    errorMessage: '',
    date: '',
    gameNo: 0,
    isToday: true,
    username: null,
    questions: [],
    statusByLetter: createInitialStatusByLetter(),
    currentIndex: 0,
    secondsLeft: 0,
    feedback: null,
    revealing: false,
    result: null,
    leaderboard: { top: [], totalPlayers: 0 },
    muted: false,
    submitting: false,
  });

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);
  const finishingRef = useRef(false);

  // ---- init ----
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/init');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as InitResponse;
        setData((prev) => ({
          ...prev,
          date: d.date,
          gameNo: d.gameNo,
          isToday: d.isToday,
          username: d.username,
          leaderboard: d.leaderboard,
          muted: d.muted,
          ...(d.status === 'finished' && d.result
            ? {
                phase: 'finished' as Phase,
                result: d.result,
                statusByLetter: d.result.statusByLetter,
              }
            : d.status === 'in_progress' && d.game
              ? {
                  phase: 'playing' as Phase,
                  questions: d.game.questions,
                  statusByLetter: d.game.statusByLetter,
                  currentIndex: d.game.currentIndex,
                  secondsLeft: d.game.secondsLeft,
                }
              : { phase: 'intro' as Phase }),
        }));
      } catch (err) {
        setData((prev) => ({
          ...prev,
          phase: 'error',
          errorMessage: err instanceof Error ? err.message : 'Failed to load',
        }));
      }
    };
    void init();
  }, []);

  // ---- countdown ----
  useEffect(() => {
    if (data.phase !== 'playing') return;
    if (data.feedback?.kind === 'wrong') return; // paused during answer reveal
    const id = window.setInterval(() => {
      setData((prev) =>
        prev.phase === 'playing' && prev.secondsLeft > 0
          ? { ...prev, secondsLeft: prev.secondsLeft - 1 }
          : prev
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [data.phase, data.feedback]);

  const finish = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      const d = await post<FinishResponse>('/api/game/finish', { reason: 'timeout' });
      setData((prev) => ({
        ...prev,
        phase: 'finished',
        result: d.result,
        statusByLetter: d.result.statusByLetter,
        feedback: null,
      }));
      void refreshLeaderboard();
    } catch (err) {
      setData((prev) => ({
        ...prev,
        phase: 'error',
        errorMessage: err instanceof Error ? err.message : 'Failed to finish',
      }));
    } finally {
      finishingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- timeout ----
  useEffect(() => {
    if (data.phase === 'playing' && data.secondsLeft === 0) void finish();
  }, [data.phase, data.secondsLeft, finish]);

  // ---- announce current question ----
  // useLayoutEffect (not useEffect) so a synchronous speak() call — which
  // flips the caller's `isSpeaking` state — commits in the same paint as the
  // new currentIndex, instead of flashing the clue text for one frame first.
  useLayoutEffect(() => {
    if (data.phase !== 'playing' || data.revealing) return;
    const q = data.questions[data.currentIndex];
    if (q) callbacksRef.current.onQuestion(q);
  }, [data.phase, data.currentIndex, data.questions, data.revealing]);

  const refreshLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) return;
      const d = (await res.json()) as { leaderboard: LeaderboardView };
      setData((prev) => ({ ...prev, leaderboard: d.leaderboard }));
    } catch {
      // non-critical
    }
  }, []);

  const start = useCallback(async () => {
    setData((prev) => ({ ...prev, submitting: true }));
    try {
      const d = await post<StartResponse>('/api/game/start');
      setData((prev) => ({
        ...prev,
        phase: 'playing',
        questions: d.questions,
        statusByLetter: d.statusByLetter,
        currentIndex: d.currentIndex,
        secondsLeft: d.secondsLeft,
        submitting: false,
      }));
    } catch (err) {
      setData((prev) => ({
        ...prev,
        submitting: false,
        errorMessage: err instanceof Error ? err.message : 'Could not start',
      }));
    }
  }, []);

  // Quick feedback path (correct / pass): flash the badge briefly, then clear.
  const applyServerState = useCallback(
    (d: GuessResponse | PassResponse, feedback: Feedback | null) => {
      setData((prev) => ({
        ...prev,
        statusByLetter: d.statusByLetter,
        currentIndex: d.currentIndex,
        secondsLeft: d.secondsLeft,
        feedback,
        submitting: false,
        ...('finished' in d && d.finished && d.result
          ? { phase: 'finished' as Phase, result: d.result, statusByLetter: d.result.statusByLetter }
          : {}),
      }));
      if (feedback) {
        window.setTimeout(() => {
          setData((prev) => (prev.feedback ? { ...prev, feedback: null } : prev));
        }, 900);
      }
      if ('finished' in d && d.finished) void refreshLeaderboard();
    },
    [refreshLeaderboard]
  );

  const guess = useCallback(
    async (answer: string) => {
      const trimmed = answer.trim();
      if (!trimmed || data.submitting || data.feedback) return;
      const letter = LETTERS[data.currentIndex]!;
      setData((prev) => ({ ...prev, submitting: true }));
      try {
        const d = await post<GuessResponse>('/api/game/guess', { letter, answer: trimmed });
        if (d.verdict === 'correct') {
          callbacksRef.current.onCorrect();
          applyServerState(d, { kind: 'correct' });
          return;
        }

        // Wrong: reveal the correct answer and read it aloud, holding the
        // turn (revealing = true suppresses the next-question announcement)
        // until the read-aloud finishes — matching the original game.
        const correctAnswer = d.correctAnswer ?? '';
        setData((prev) => ({
          ...prev,
          statusByLetter: d.statusByLetter,
          currentIndex: d.currentIndex,
          secondsLeft: d.secondsLeft,
          feedback: { kind: 'wrong', correctAnswer },
          revealing: !d.finished,
          submitting: false,
        }));

        await callbacksRef.current.onWrong(correctAnswer);

        if (d.finished && d.result) {
          const result = d.result;
          setData((prev) => ({
            ...prev,
            phase: 'finished',
            result,
            statusByLetter: result.statusByLetter,
            feedback: null,
            revealing: false,
          }));
          void refreshLeaderboard();
        } else {
          setData((prev) => ({ ...prev, feedback: null, revealing: false }));
        }
      } catch (err) {
        setData((prev) => ({ ...prev, submitting: false, revealing: false }));
        console.error('guess failed:', err);
      }
    },
    [data.submitting, data.feedback, data.currentIndex, applyServerState, refreshLeaderboard]
  );

  const pass = useCallback(async () => {
    if (data.submitting || data.feedback) return;
    const letter = LETTERS[data.currentIndex]!;
    callbacksRef.current.onPass();
    setData((prev) => ({ ...prev, submitting: true }));
    try {
      const d = await post<PassResponse>('/api/game/pass', { letter });
      applyServerState(d, { kind: 'passed' });
    } catch (err) {
      setData((prev) => ({ ...prev, submitting: false }));
      console.error('pass failed:', err);
    }
  }, [data.submitting, data.feedback, data.currentIndex, applyServerState]);

  const toggleMute = useCallback(async () => {
    const muted = !data.muted;
    setData((prev) => ({ ...prev, muted }));
    try {
      await post('/api/prefs', { muted });
    } catch {
      // preference is best-effort
    }
  }, [data.muted]);

  const share = useCallback(async (): Promise<ShareResponse | null> => {
    try {
      return await post<ShareResponse>('/api/share');
    } catch (err) {
      console.error('share failed:', err);
      return null;
    }
  }, []);

  return { ...data, start, guess, pass, finish, toggleMute, share, refreshLeaderboard };
}

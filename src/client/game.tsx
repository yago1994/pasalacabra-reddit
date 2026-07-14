import './index.css';

import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { cluePrefix, LETTERS, REVEAL_PAUSE_MS, type ClientQuestion } from '../shared/letters';
import { useGame } from './hooks/useGame';
import { useSfx } from './hooks/useSfx';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import { LetterRing } from './components/LetterRing';
import { AnswerInput } from './components/AnswerInput';
import { ResultsPanel } from './components/ResultsPanel';
import { Leaderboard } from './components/Leaderboard';
import cabraUrl from './assets/cabra.png';

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Spoken narration, mirroring the original game's English locale
// (src/locale/config.ts: ttsYes / ttsTimeUp). "Ahnd that's Time!" is a
// deliberate phonetic spelling so the TTS engine pronounces it as intended.
const TTS_YES = 'Yes';
const TTS_TIME_UP = "Ahnd that's Time!";

export const App = () => {
  // useGame needs the callbacks before sfx/tts exist (they depend on
  // game.muted), so route them through refs updated after every render.
  const playSfxRef = useRef<(key: 'correct' | 'wrong' | 'pasalacabra') => void>(() => {});
  const speakRef = useRef<(prefix: string, question: string) => void>(() => {});
  const onCorrectRef = useRef<() => Promise<void>>(async () => {});
  const onWrongRef = useRef<(correctAnswer: string) => Promise<void>>(async () => {});
  const onTimeUpRef = useRef<() => void>(() => {});

  // Letters whose clue has already been read once this session. On the first
  // read of a letter we lock the input until the read-aloud finishes; on a
  // repeat (a passed letter coming back around on a later lap) the input is
  // active the moment the voice starts, since the player already heard it.
  const seenLettersRef = useRef<Set<string>>(new Set());
  const [firstRead, setFirstRead] = useState(true);

  const game = useGame({
    onCorrect: () => onCorrectRef.current(),
    onWrong: (correctAnswer: string) => onWrongRef.current(correctAnswer),
    onPass: () => playSfxRef.current('pasalacabra'),
    onTimeUp: () => onTimeUpRef.current(),
    onQuestion: (q: ClientQuestion) => {
      const isFirst = !seenLettersRef.current.has(q.letter);
      seenLettersRef.current.add(q.letter);
      setFirstRead(isFirst);
      speakRef.current(cluePrefix(q.mode, q.letter), q.question);
    },
  });

  const sfx = useSfx(game.muted);
  const tts = useSpeechSynthesis(game.muted);

  useEffect(() => {
    playSfxRef.current = sfx.play;
    speakRef.current = tts.speak;
    // Correct answer: play the chime, then speak the affirmation ("Yes").
    // useGame awaits this before advancing, so "Yes" isn't cut off by the next
    // clue — mirroring the original game.
    onCorrectRef.current = async () => {
      sfx.play('correct');
      if (tts.supported && !game.muted) {
        await new Promise((r) => setTimeout(r, 120)); // brief gap after the chime
        await tts.speakLine(TTS_YES);
      }
    };
    // Time's up: speak the end phrase as the game finishes.
    onTimeUpRef.current = () => {
      void tts.speakLine(TTS_TIME_UP);
    };
    // Wrong answer: play the buzzer, then read the correct answer aloud and
    // hold the reveal until it finishes. Where TTS can't run, fall back to a
    // fixed pause so the revealed answer stays on screen long enough to read.
    onWrongRef.current = async (correctAnswer: string) => {
      sfx.play('wrong');
      // Hold the reveal at least REVEAL_PAUSE_MS so a silent/broken TTS engine
      // still shows the answer long enough to read; if speech runs longer, wait
      // for it. Running both in parallel means real TTS drives the timing and
      // the fixed pause is just a floor.
      const minReveal = new Promise((r) => setTimeout(r, REVEAL_PAUSE_MS));
      if (tts.supported && !game.muted && correctAnswer) {
        await new Promise((r) => setTimeout(r, 250)); // brief gap after the buzzer
        await Promise.all([
          tts.speakLine(`No. The correct answer is: ${correctAnswer}.`),
          minReveal,
        ]);
      } else {
        await minReveal;
      }
    };
  });

  // 3-2-1 countdown before the timer/first clue actually start.
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      sfx.playTone(880, 220);
      const t = window.setTimeout(() => {
        setCountdown(null);
        void game.start();
      }, 400);
      return () => window.clearTimeout(t);
    }
    sfx.playTone(440, 140);
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const handlePlayClick = async () => {
    // Both must happen inside this user gesture: Web Audio unlock, and the
    // speech-engine prime that iOS requires before speak() will make sound.
    tts.warmUp();
    await sfx.ensureReady();
    setCountdown(3);
  };

  const currentQuestion = game.questions[game.currentIndex];
  const correct = Object.values(game.statusByLetter).filter((s) => s === 'correct').length;
  const wrong = Object.values(game.statusByLetter).filter((s) => s === 'wrong').length;
  // Only block input during a clue read the FIRST time each letter is heard.
  const lockForRead = tts.isSpeaking && firstRead;

  if (game.phase === 'loading') {
    return (
      <Shell>
        <p className="animate-pulse text-white/70">Loading today's ring…</p>
      </Shell>
    );
  }

  if (game.phase === 'error') {
    return (
      <Shell>
        <p className="px-4 text-center text-red-300">Something went wrong: {game.errorMessage}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl bg-white/10 px-4 py-2 text-white hover:bg-white/20"
        >
          Retry
        </button>
      </Shell>
    );
  }

  if (game.phase === 'finished' && game.result) {
    return (
      <Shell scroll>
        <ResultsPanel
          result={game.result}
          gameNo={game.gameNo}
          leaderboard={game.leaderboard}
          username={game.username}
          isToday={game.isToday}
          onShare={game.share}
        />
      </Shell>
    );
  }

  if (game.phase === 'intro') {
    if (countdown !== null) {
      return (
        <Shell>
          <p className="text-9xl font-black text-white tabular-nums">
            {countdown === 0 ? 'Go!' : countdown}
          </p>
        </Shell>
      );
    }

    return (
      <Shell scroll>
        <img src={cabraUrl} alt="Pasalacabra goat" className="h-24 w-24 object-contain" />
        <h1 className="text-3xl font-extrabold text-white">Pasala🐐 #{game.gameNo}</h1>
        <p className="max-w-sm text-center text-white/80">
          26 clues, one per letter A to Z. Type each answer before the clock runs out — or say
          "Pasalacabra" to skip and come back later.
        </p>
        {game.username ? (
          <>
            <button
              onClick={() => void handlePlayClick()}
              disabled={game.submitting}
              className="rounded-2xl bg-emerald-500 px-10 py-4 text-xl font-extrabold text-white shadow-lg transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              {game.submitting ? 'Starting…' : 'Play'}
            </button>
            <p className="text-xs text-white/50">🔊 Turn up your volume — this game has sound</p>
          </>
        ) : (
          <p className="font-semibold text-amber-300">Log in to Reddit to play and rank.</p>
        )}
        {game.errorMessage && <p className="text-sm text-red-300">{game.errorMessage}</p>}
        <div className="mt-4 w-full max-w-md px-4">
          <h2 className="mb-2 text-lg font-bold text-white">Today's leaderboard</h2>
          <Leaderboard view={game.leaderboard} myUsername={game.username} />
        </div>
      </Shell>
    );
  }

  // ---- playing ----
  return (
    <div className="flex h-dvh flex-col items-center gap-2 overflow-hidden bg-[var(--bg)] px-3 py-2">
      <div className="flex w-full max-w-md items-center justify-between text-white">
        <span className="text-lg font-bold tabular-nums">⏱️ {formatTime(game.secondsLeft)}</span>
        <span className="text-sm text-white/80">
          🟢 {correct} · 🔴 {wrong}
        </span>
        <button
          onClick={() => void game.toggleMute()}
          aria-label={game.muted ? 'Unmute sounds' : 'Mute sounds'}
          className="rounded-lg bg-white/10 px-3 py-1 text-lg hover:bg-white/20"
        >
          {game.muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div className="aspect-square h-full max-h-full w-auto max-w-full">
          <LetterRing statusByLetter={game.statusByLetter} currentIndex={game.currentIndex} />
        </div>
      </div>

      <div className="min-h-[4.5rem] w-full max-w-md rounded-2xl bg-white/10 px-4 py-3 text-center">
        {game.feedback?.kind === 'wrong' ? (
          <p className="text-lg font-bold text-red-300">
            ❌ It was: <span className="text-white">{game.feedback.correctAnswer}</span>
          </p>
        ) : game.feedback?.kind === 'correct' ? (
          <p className="text-lg font-bold text-emerald-300">✅ Correct!</p>
        ) : game.feedback?.kind === 'passed' ? (
          <p className="text-lg font-bold text-sky-300">🐐 Passed!</p>
        ) : lockForRead ? (
          <p className="text-sm italic text-white/50">🔊 Reading the clue…</p>
        ) : currentQuestion ? (
          <>
            <p className="text-xs font-bold tracking-wide text-cyan-300 uppercase">
              {cluePrefix(currentQuestion.mode, LETTERS[game.currentIndex]!)}
            </p>
            <p className="text-base leading-snug text-white">{currentQuestion.question}</p>
          </>
        ) : null}
      </div>

      <div className="w-full max-w-md pb-1">
        <AnswerInput
          disabled={game.submitting || game.feedback !== null || lockForRead}
          onGuess={(answer) => void game.guess(answer)}
          onPass={() => void game.pass()}
        />
      </div>
    </div>
  );
};

function Shell({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-4 bg-[var(--bg)] px-4 py-6 ${
        scroll ? 'h-dvh justify-start overflow-y-auto' : 'min-h-dvh justify-center'
      }`}
    >
      {children}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

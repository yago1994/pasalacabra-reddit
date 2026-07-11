import { useEffect, useRef, useState } from 'react';
import type { GameResult, LeaderboardView, ShareResponse } from '../../shared/api';
import { Leaderboard } from './Leaderboard';
import { AnswerList } from './AnswerList';
import { LetterBadges } from './LetterBadges';
import { GoatConfetti } from './GoatConfetti';
import { canvasToPngBlob, renderResultsSnapshot } from '../game/resultsSnapshot';

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Props = {
  result: GameResult;
  gameNo: number;
  leaderboard: LeaderboardView;
  username: string | null;
  isToday: boolean;
  onShare: () => Promise<ShareResponse | null>;
};

type ShareState = 'idle' | 'sharing' | 'copied-image' | 'commented' | 'copied-text' | 'failed';

export function ResultsPanel({ result, gameNo, leaderboard, username, isToday, onShare }: Props) {
  const [shareState, setShareState] = useState<ShareState>('idle');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      renderResultsSnapshot(canvasRef.current, result.statusByLetter, {
        gameNo,
        correct: result.correct,
        wrong: result.wrong,
        timeUsedSeconds: result.timeUsedSeconds,
        ...(isToday ? { rank: result.rank, totalPlayers: result.totalPlayers } : {}),
        streak: result.streak,
      });
    }
  }, [result, gameNo, isToday]);

  const handleShare = async () => {
    setShareState('sharing');

    // 1) Try copying the rendered snapshot image — the closest thing to a
    // "screenshot" a sandboxed webview can produce without external image
    // hosting (Reddit's media API only ingests pre-hosted URLs).
    try {
      if (canvasRef.current && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blob = await canvasToPngBlob(canvasRef.current);
        if (blob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setShareState('copied-image');
          return;
        }
      }
    } catch {
      // fall through to text-based sharing
    }

    // 2) Post the emoji-ring result as a comment on the daily post.
    const res = await onShare();
    if (res?.posted) {
      setShareState('commented');
      return;
    }

    // 3) Last resort: copy the text.
    try {
      await navigator.clipboard.writeText(res?.shareText ?? '');
      setShareState('copied-text');
    } catch {
      setShareState('failed');
    }
  };

  const skip = 26 - result.correct - result.wrong;

  return (
    <div className="relative flex w-full flex-col items-center gap-4 px-4 py-6 text-center">
      <GoatConfetti />

      <p className="text-sm font-semibold tracking-wide text-white/50 uppercase">🎮 Game over</p>
      <h1 className="text-3xl font-extrabold text-white">Pasala🐐 #{gameNo}</h1>

      {/* Letters on top… */}
      <LetterBadges statusByLetter={result.statusByLetter} />

      {/* …then the summary, centered below. */}
      <p className="text-lg font-semibold text-white/90">
        🟢 {result.correct} · 🔴 {result.wrong} · 🔵 {skip} · ⏱️ {formatTime(result.timeUsedSeconds)}
      </p>

      {/* Hidden — rendered only to produce the shareable PNG. */}
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      {isToday && result.rank > 0 && (
        <p className="text-white/80">
          Rank <span className="font-bold text-cyan-300">#{result.rank}</span> of {result.totalPlayers} today
          {result.streak > 1 && <span className="ml-2">🔥 {result.streak}-day streak</span>}
        </p>
      )}

      <button
        onClick={() => void handleShare()}
        disabled={shareState === 'sharing'}
        className="rounded-xl bg-emerald-500 px-6 py-3 font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {shareState === 'idle' && '📸 Share result'}
        {shareState === 'sharing' && 'Sharing…'}
        {shareState === 'copied-image' && 'Image copied — paste it anywhere! ✅'}
        {shareState === 'commented' && 'Posted as a comment ✅'}
        {shareState === 'copied-text' && 'Copied to clipboard ✅'}
        {shareState === 'failed' && 'Sharing unavailable 😞'}
      </button>

      <div className="mt-2 w-full max-w-md">
        <h2 className="mb-2 text-lg font-bold text-white">Today's leaderboard</h2>
        <Leaderboard view={leaderboard} myUsername={username} />
      </div>

      {result.answers.length > 0 && (
        <div className="mt-2 w-full max-w-md">
          <h2 className="mb-2 text-lg font-bold text-white">The answers</h2>
          <AnswerList answers={result.answers} />
        </div>
      )}

      <p className="text-center text-xs text-white/40">
        New ring every day at 06:00 UTC. Keep your streak alive!
      </p>
    </div>
  );
}

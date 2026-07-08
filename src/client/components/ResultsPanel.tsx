import { useState } from 'react';
import type { GameResult, LeaderboardView, ShareResponse } from '../../shared/api';
import { LetterRing } from './LetterRing';
import { Leaderboard } from './Leaderboard';

type Props = {
  result: GameResult;
  gameNo: number;
  leaderboard: LeaderboardView;
  username: string | null;
  isToday: boolean;
  onShare: () => Promise<ShareResponse | null>;
};

export function ResultsPanel({ result, gameNo, leaderboard, username, isToday, onShare }: Props) {
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'commented' | 'copied' | 'failed'>('idle');

  const handleShare = async () => {
    setShareState('sharing');
    const res = await onShare();
    if (res?.posted) {
      setShareState('commented');
      return;
    }
    // Fallback: clipboard (may be unavailable in some webviews).
    try {
      await navigator.clipboard.writeText(res?.shareText ?? '');
      setShareState('copied');
    } catch {
      setShareState('failed');
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-4 px-4 py-6">
      <h1 className="text-2xl font-extrabold text-white">
        Pasala🐐 #{gameNo}
      </h1>
      <p className="text-lg text-white/90">
        🟢 {result.correct} · 🔴 {result.wrong} · 🔵 {26 - result.correct - result.wrong}
      </p>
      {isToday && result.rank > 0 && (
        <p className="text-white/80">
          Rank <span className="font-bold text-cyan-300">#{result.rank}</span> of {result.totalPlayers} today
          {result.streak > 1 && (
            <span className="ml-2">🔥 {result.streak}-day streak</span>
          )}
        </p>
      )}

      <div className="w-full max-w-[300px]">
        <LetterRing statusByLetter={result.statusByLetter} currentIndex={-1} />
      </div>

      <button
        onClick={() => void handleShare()}
        disabled={shareState === 'sharing'}
        className="rounded-xl bg-emerald-500 px-6 py-3 font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {shareState === 'idle' && 'Share result 🐐'}
        {shareState === 'sharing' && 'Sharing…'}
        {shareState === 'commented' && 'Posted as a comment ✅'}
        {shareState === 'copied' && 'Copied to clipboard ✅'}
        {shareState === 'failed' && 'Sharing unavailable 😞'}
      </button>

      <div className="mt-2 w-full max-w-md">
        <h2 className="mb-2 text-lg font-bold text-white">Today's leaderboard</h2>
        <Leaderboard view={leaderboard} myUsername={username} />
      </div>

      <p className="text-center text-xs text-white/40">
        New ring every day at 06:00 UTC. Keep your streak alive!
      </p>
    </div>
  );
}

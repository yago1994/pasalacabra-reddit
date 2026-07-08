import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { context, requestExpandedMode } from '@devvit/web/client';
import cabraUrl from './assets/cabra.png';

export const Splash = () => {
  const postData = context.postData as { gameNo?: number } | undefined;
  const gameNo = postData?.gameNo;

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-[var(--bg)] px-4 py-6">
      <img src={cabraUrl} alt="Pasalacabra goat" className="h-20 w-20 object-contain" />
      <h1 className="text-2xl font-extrabold text-white">
        Pasala🐐{gameNo ? ` #${gameNo}` : ''}
      </h1>
      <p className="max-w-xs text-center text-sm text-white/80">
        The daily word ring: 26 clues, A to Z, one clock. Can you beat today's leaderboard?
      </p>
      <button
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        className="rounded-2xl bg-emerald-500 px-8 py-3 text-lg font-extrabold text-white shadow-lg transition-colors hover:bg-emerald-400"
      >
        Play
      </button>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);

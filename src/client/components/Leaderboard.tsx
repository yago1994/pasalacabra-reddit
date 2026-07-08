import type { LeaderboardView } from '../../shared/api';

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Leaderboard({ view, myUsername }: { view: LeaderboardView; myUsername: string | null }) {
  if (view.totalPlayers === 0) {
    return <p className="text-sm text-white/60">No one has played today's ring yet. Be the first!</p>;
  }

  const showMeRow = view.me && !view.top.some((row) => row.rank === view.me!.rank);

  return (
    <div className="w-full max-w-md">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-white/50">
            <th className="py-1 pr-2 font-medium">#</th>
            <th className="py-1 pr-2 font-medium">Player</th>
            <th className="py-1 pr-2 text-right font-medium">🟢</th>
            <th className="py-1 pr-2 text-right font-medium">🔴</th>
            <th className="py-1 text-right font-medium">⏱️</th>
          </tr>
        </thead>
        <tbody>
          {view.top.map((row) => (
            <tr
              key={row.rank}
              className={
                row.username === myUsername
                  ? 'rounded bg-cyan-400/15 font-semibold text-cyan-200'
                  : 'text-white/85'
              }
            >
              <td className="py-1 pr-2">{row.rank}</td>
              <td className="max-w-[10rem] truncate py-1 pr-2">u/{row.username}</td>
              <td className="py-1 pr-2 text-right">{row.correct}</td>
              <td className="py-1 pr-2 text-right">{row.wrong}</td>
              <td className="py-1 text-right">{formatTime(row.timeUsedSeconds)}</td>
            </tr>
          ))}
          {showMeRow && view.me && (
            <tr className="font-semibold text-cyan-200">
              <td className="py-1 pr-2">{view.me.rank}</td>
              <td className="max-w-[10rem] truncate py-1 pr-2">u/{view.me.username}</td>
              <td className="py-1 pr-2 text-right">{view.me.correct}</td>
              <td className="py-1 pr-2 text-right">{view.me.wrong}</td>
              <td className="py-1 text-right">{formatTime(view.me.timeUsedSeconds)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-white/40">{view.totalPlayers} player{view.totalPlayers === 1 ? '' : 's'} today</p>
    </div>
  );
}

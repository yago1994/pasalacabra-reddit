import { redis } from '@devvit/web/server';
import { TURN_SECONDS } from '../../shared/letters';
import type { LeaderboardRow, LeaderboardView } from '../../shared/api';
import { lbKey, lbNamesKey, LB_TTL_SECONDS } from './redisKeys';

// Composite score: more correct > fewer wrong > faster.
// correct ≤ 26, wrong ≤ 26, timeBonus ≤ TURN_SECONDS (240) — no tier overlap.
function encodeScore(correct: number, wrong: number, timeUsed: number): number {
  const timeBonus = Math.max(0, TURN_SECONDS - timeUsed);
  return correct * 1e7 + (999 - wrong) * 1e4 + timeBonus;
}

type RowMeta = { username: string; correct: number; wrong: number; timeUsed: number };

export async function recordScore(params: {
  date: string;
  userId: string;
  username: string;
  correct: number;
  wrong: number;
  timeUsed: number;
}): Promise<void> {
  const { date, userId, username, correct, wrong, timeUsed } = params;
  const existing = await redis.zScore(lbKey(date), userId);
  if (existing !== undefined) return; // one score per user per day

  const meta: RowMeta = { username, correct, wrong, timeUsed };
  await redis.zAdd(lbKey(date), { member: userId, score: encodeScore(correct, wrong, timeUsed) });
  await redis.hSet(lbNamesKey(date), { [userId]: JSON.stringify(meta) });
  await redis.expire(lbKey(date), LB_TTL_SECONDS);
  await redis.expire(lbNamesKey(date), LB_TTL_SECONDS);
}

export async function getRank(
  date: string,
  userId: string
): Promise<{ rank: number; totalPlayers: number }> {
  const [ascRank, totalPlayers] = await Promise.all([
    redis.zRank(lbKey(date), userId),
    redis.zCard(lbKey(date)),
  ]);
  // zRank is ascending and 0-based; descending 1-based rank:
  const rank = ascRank === undefined ? 0 : totalPlayers - ascRank;
  return { rank, totalPlayers };
}

export async function getLeaderboard(
  date: string,
  userId: string | null,
  topN = 10
): Promise<LeaderboardView> {
  const [entries, totalPlayers] = await Promise.all([
    redis.zRange(lbKey(date), 0, topN - 1, { by: 'rank', reverse: true }),
    redis.zCard(lbKey(date)),
  ]);

  const view: LeaderboardView = { top: [], totalPlayers };
  if (entries.length === 0) return view;

  const metasRaw = await redis.hMGet(
    lbNamesKey(date),
    entries.map((e) => e.member)
  );

  entries.forEach((entry, i) => {
    const metaRaw = metasRaw[i];
    if (!metaRaw) return;
    const meta = JSON.parse(metaRaw) as RowMeta;
    const row: LeaderboardRow = {
      username: meta.username,
      correct: meta.correct,
      wrong: meta.wrong,
      timeUsedSeconds: meta.timeUsed,
      rank: i + 1,
    };
    view.top.push(row);
    if (userId && entry.member === userId) view.me = row;
  });

  if (userId && !view.me) {
    const [rank, metaRaw] = await Promise.all([
      getRank(date, userId),
      redis.hGet(lbNamesKey(date), userId),
    ]);
    if (rank.rank > 0 && metaRaw) {
      const meta = JSON.parse(metaRaw) as RowMeta;
      view.me = {
        username: meta.username,
        correct: meta.correct,
        wrong: meta.wrong,
        timeUsedSeconds: meta.timeUsed,
        rank: rank.rank,
      };
    }
  }

  return view;
}

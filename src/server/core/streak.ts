import { redis } from '@devvit/web/server';
import { userKey } from './redisKeys';

function previousDateKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function getStreak(userId: string): Promise<{ streak: number; maxStreak: number }> {
  const raw = await redis.hGetAll(userKey(userId));
  return { streak: Number(raw?.streak ?? 0), maxStreak: Number(raw?.maxStreak ?? 0) };
}

/** Called once per finished game on the current day's puzzle. Idempotent per day. */
export async function updateStreak(
  userId: string,
  date: string
): Promise<{ streak: number; maxStreak: number }> {
  const key = userKey(userId);
  const raw = await redis.hGetAll(key);
  const lastPlayed = raw?.lastPlayedDate ?? '';
  let streak = Number(raw?.streak ?? 0);
  let maxStreak = Number(raw?.maxStreak ?? 0);

  if (lastPlayed === date) return { streak, maxStreak };

  streak = lastPlayed === previousDateKey(date) ? streak + 1 : 1;
  maxStreak = Math.max(maxStreak, streak);

  await redis.hSet(key, {
    streak: String(streak),
    maxStreak: String(maxStreak),
    lastPlayedDate: date,
  });
  return { streak, maxStreak };
}

export async function getMuted(userId: string): Promise<boolean> {
  const muted = await redis.hGet(userKey(userId), 'muted');
  return muted === '1';
}

export async function setMuted(userId: string, muted: boolean): Promise<void> {
  await redis.hSet(userKey(userId), { muted: muted ? '1' : '0' });
}

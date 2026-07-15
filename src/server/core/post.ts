import { redis, reddit } from '@devvit/web/server';
import { formatDateLong, utcDateKey } from '../../shared/dailyIssue';
import { getOrCreatePuzzle } from './puzzle';
import { dailyPostGuardKey, postKey, stickyCommentKey, POST_TTL_SECONDS } from './redisKeys';

const STICKY_COMMENT_TEXT =
  "Post your results here! 🐐 Share your score by replying to this comment — top-level comments are for discussing today's ring.";

/** Creates the sticky comment score-shares reply to, and remembers its id. */
const createStickyComment = async (postId: `t3_${string}`): Promise<`t1_${string}`> => {
  const comment = await reddit.submitComment({
    id: postId,
    text: STICKY_COMMENT_TEXT,
    runAs: 'APP',
  });
  await comment.distinguish(true);
  await redis.set(stickyCommentKey(postId), comment.id);
  await redis.expire(stickyCommentKey(postId), POST_TTL_SECONDS);
  return comment.id;
};

/**
 * Create the daily puzzle post (idempotent per date). Returns the post id,
 * or null if today's post already exists.
 */
export const createDailyPost = async (date: string = utcDateKey()): Promise<string | null> => {
  const guard = await redis.set(dailyPostGuardKey(date), '1', { nx: true });
  if (!guard) return null;
  await redis.expire(dailyPostGuardKey(date), POST_TTL_SECONDS);

  const puzzle = await getOrCreatePuzzle(date);
  const post = await reddit.submitCustomPost({
    title: `Pasalacabra 🐐 #${puzzle.gameNo} — ${formatDateLong(date)}`,
    postData: { date, gameNo: puzzle.gameNo },
    textFallback: {
      text: `Pasalacabra #${puzzle.gameNo}: the daily word ring. Answer one clue per letter, A to Z, before the goat runs out of time. Play on the Reddit app or new reddit.`,
    },
  });

  await redis.set(postKey(post.id), date);
  await redis.expire(postKey(post.id), POST_TTL_SECONDS);
  await createStickyComment(post.id);
  return post.id;
};

/**
 * The sticky comment score-share replies should land under. Creates one
 * lazily for posts that predate this feature.
 */
export const getStickyCommentId = async (postId: `t3_${string}`): Promise<`t1_${string}`> => {
  const stored = await redis.get(stickyCommentKey(postId));
  if (stored) return stored as `t1_${string}`;
  return createStickyComment(postId);
};

/** Which date's puzzle does this post host? */
export const dateForPost = async (postId: string): Promise<string> => {
  const stored = await redis.get(postKey(postId));
  if (stored) return stored;
  // Fallback (pre-mapping posts): treat as today and remember it.
  const today = utcDateKey();
  await redis.set(postKey(postId), today);
  await redis.expire(postKey(postId), POST_TTL_SECONDS);
  return today;
};

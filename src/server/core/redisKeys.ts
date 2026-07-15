export const DAY_SECONDS = 24 * 60 * 60;

/** Full puzzle (with answers) for a date. */
export const puzzleKey = (date: string) => `puzzle:${date}`;
/** Per-user game state hash. */
export const gameKey = (date: string, userId: string) => `game:${date}:${userId}`;
/** Daily leaderboard zset (higher score = better). */
export const lbKey = (date: string) => `lb:${date}`;
/** userId → username for leaderboard display. */
export const lbNamesKey = (date: string) => `lbnames:${date}`;
/** Per-user persistent hash: streak, maxStreak, lastPlayedDate, muted. */
export const userKey = (userId: string) => `user:${userId}`;
/** postId → puzzle date fallback (postData is the primary source). */
export const postKey = (postId: string) => `post:${postId}`;
/** Guard so the daily post is only created once per date. */
export const dailyPostGuardKey = (date: string) => `dailypost:${date}`;
/** postId → sticky comment id (t1_...) that score-share replies land under. */
export const stickyCommentKey = (postId: string) => `sticky:${postId}`;

export const PUZZLE_TTL_SECONDS = 90 * DAY_SECONDS;
export const GAME_TTL_SECONDS = 30 * DAY_SECONDS;
export const LB_TTL_SECONDS = 30 * DAY_SECONDS;
export const POST_TTL_SECONDS = 90 * DAY_SECONDS;

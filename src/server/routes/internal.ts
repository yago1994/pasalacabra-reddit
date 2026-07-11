import { Hono } from 'hono';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import { createDailyPost, dateForPost } from '../core/post';
import { gameKey, lbKey, lbNamesKey } from '../core/redisKeys';

export const internal = new Hono();

// Scheduler: creates each day's puzzle post.
internal.post('/scheduler/daily-post', async (c) => {
  try {
    const postId = await createDailyPost();
    console.log(postId ? `Daily post created: ${postId}` : 'Daily post already exists');
    return c.json({ status: 'success' }, 200);
  } catch (error) {
    console.error('daily-post task failed:', error);
    return c.json({ status: 'error' }, 500);
  }
});

// First post right after the app is installed on a subreddit.
internal.post('/triggers/on-app-install', async (c) => {
  try {
    const postId = await createDailyPost();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Installed on ${context.subredditName}; first post ${postId ?? 'already existed'}`,
      },
      200
    );
  } catch (error) {
    console.error('on-app-install failed:', error);
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create post' }, 400);
  }
});

// Manual backstop if the cron ever misses a day.
internal.post('/menu/post-create', async (c) => {
  try {
    const postId = await createDailyPost();
    if (!postId) {
      return c.json<UiResponse>({ showToast: "Today's post already exists" }, 200);
    }
    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}` },
      200
    );
  } catch (error) {
    console.error('menu post-create failed:', error);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

// Testing helper: clears the moderator's own progress on today's post so
// they can replay it during playtest. Only ever touches the caller's own
// data (menu actions run in the clicking user's context).
internal.post('/menu/reset-my-game', async (c) => {
  const { postId, userId } = context;
  if (!postId || !userId) {
    return c.json<UiResponse>({ showToast: 'Not available: missing user/post context' }, 400);
  }
  try {
    const date = await dateForPost(postId);
    await redis.del(gameKey(date, userId));
    await redis.zRem(lbKey(date), [userId]);
    await redis.hDel(lbNamesKey(date), [userId]);
    return c.json<UiResponse>({ showToast: `Reset — reload to replay #${date}` }, 200);
  } catch (error) {
    console.error('reset-my-game failed:', error);
    return c.json<UiResponse>({ showToast: 'Failed to reset' }, 400);
  }
});

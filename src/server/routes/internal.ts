import { Hono } from 'hono';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/post';

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

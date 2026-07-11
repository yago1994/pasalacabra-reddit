import { useCallback, useEffect, useRef } from 'react';
import sfxCorrectUrl from '../assets/sfx-correct.wav';
import sfxWrongUrl from '../assets/sfx-wrong.wav';
import sfxPasalacabraUrl from '../assets/sfx-pasalacabra.wav';

type SfxKey = 'correct' | 'wrong' | 'pasalacabra';

const SFX_URLS: Record<SfxKey, string> = {
  correct: sfxCorrectUrl,
  wrong: sfxWrongUrl,
  pasalacabra: sfxPasalacabraUrl,
};

/**
 * Web Audio SFX with decode-once buffers. Playback only ever happens in
 * response to a user action (a review requirement), and `muted` gates
 * everything, including while the page is hidden.
 */
export function useSfx(muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Partial<Record<SfxKey, AudioBuffer>>>({});
  const rawRef = useRef<Partial<Record<SfxKey, ArrayBuffer>>>({});
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const getCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current;
    try {
      ctxRef.current = new AudioContext();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  // Prefetch raw bytes early (no user gesture needed for fetch).
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(
      (Object.entries(SFX_URLS) as [SfxKey, string][]).map(async ([key, url]) => {
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (res.ok) rawRef.current[key] = await res.arrayBuffer();
        } catch {
          // retried on demand
        }
      })
    );
    return () => controller.abort();
  }, []);

  const ensureReady = useCallback(async () => {
    const ctx = getCtx();
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') await ctx.resume();
    } catch {
      // playback may no-op until a later gesture
    }
    if (loadPromiseRef.current) return loadPromiseRef.current;
    loadPromiseRef.current = (async () => {
      await Promise.all(
        (Object.entries(SFX_URLS) as [SfxKey, string][]).map(async ([key, url]) => {
          if (buffersRef.current[key]) return;
          try {
            const raw = rawRef.current[key] ?? (await (await fetch(url)).arrayBuffer());
            rawRef.current[key] = raw;
            buffersRef.current[key] = await ctx.decodeAudioData(raw.slice(0));
          } catch {
            // missing buffer = no sound for that key
          }
        })
      );
    })();
    return loadPromiseRef.current;
  }, [getCtx]);

  // Unlock audio on first pointer interaction (mobile requirement).
  useEffect(() => {
    const handler = () => void ensureReady();
    window.addEventListener('pointerdown', handler, { capture: true });
    return () => window.removeEventListener('pointerdown', handler, { capture: true });
  }, [ensureReady]);

  // Suspend audio when the post is scrolled away / backgrounded (review requirement).
  useEffect(() => {
    const onVisibility = () => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      if (document.visibilityState === 'hidden') void ctx.suspend().catch(() => {});
      else if (!mutedRef.current) void ctx.resume().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const play = useCallback(
    (key: SfxKey) => {
      if (mutedRef.current) return;
      const ctx = getCtx();
      const buf = buffersRef.current[key];
      if (!ctx || !buf) return;

      const start = () => {
        try {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const gain = ctx.createGain();
          gain.gain.value = key === 'pasalacabra' ? 1.0 : 0.95;
          src.connect(gain);
          gain.connect(ctx.destination);
          src.start();
        } catch {
          // ignore
        }
      };

      if (ctx.state !== 'running') {
        void ctx.resume().then(start).catch(start);
        return;
      }
      start();
    },
    [getCtx]
  );

  const playTone = useCallback(
    (frequencyHz: number, durationMs: number) => {
      if (mutedRef.current) return;
      const ctx = getCtx();
      if (!ctx) return;

      const start = () => {
        try {
          const t0 = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(frequencyHz, t0);
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + durationMs / 1000 + 0.02);
        } catch {
          // ignore
        }
      };

      if (ctx.state !== 'running') {
        void ctx.resume().then(start).catch(start);
        return;
      }
      start();
    },
    [getCtx]
  );

  return { play, playTone, ensureReady };
}

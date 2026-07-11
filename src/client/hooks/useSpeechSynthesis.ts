import { useCallback, useEffect, useRef, useState } from 'react';

const SPEECH_RATE = 0.82;
/** Safety cap in case an utterance's `onend` never fires (some webviews are flaky). */
const MAX_SPEECH_MS = 15000;
/**
 * How long to wait for `onstart` before deciding the engine is broken. iOS
 * WKWebView (the Reddit iOS app) exposes speechSynthesis but frequently
 * produces no audio and fires no events; without a start deadline the UI would
 * sit on "Reading the clue…" until the end-watchdog fires seconds later.
 */
const START_GRACE_MS = 1500;

/**
 * Experimental clue read-aloud via the browser-built-in speechSynthesis.
 *
 * Detection strategy: we don't try to predict support up front (getVoices()
 * lies on Android; the API exists but is dead on iOS WKWebView). Instead we
 * attempt speech and watch for `onstart`:
 *  - if it fires, the engine works — remember that and use a length-scaled
 *    end-watchdog as a safety net;
 *  - if it doesn't fire within START_GRACE_MS, mark speech broken, bail
 *    immediately (reveal the clue, unlock input), and skip the attempt (and
 *    its lock) for every subsequent clue.
 *
 * `warmUp()` primes the engine from inside a user gesture, which iOS requires
 * before speak() will do anything.
 */
export function useSpeechSynthesis(muted: boolean) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const mutedRef = useRef(muted);
  const endTimerRef = useRef<number | null>(null);
  const startTimerRef = useRef<number | null>(null);
  // null = unknown, true = confirmed working, false = confirmed dead.
  const speechWorksRef = useRef<boolean | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const clearTimers = useCallback(() => {
    if (endTimerRef.current !== null) {
      window.clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimers();
    if (supported) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [supported, clearTimers]);

  /** Speak the given lines in order; resolve when done, bailed, or skipped. */
  const run = useCallback(
    (lines: string[]): Promise<void> => {
      if (!supported || mutedRef.current) return Promise.resolve();
      // Known-dead engine: don't lock the UI, just reveal immediately.
      if (speechWorksRef.current === false) return Promise.resolve();

      window.speechSynthesis.cancel();
      clearTimers();
      setIsSpeaking(true);

      return new Promise<void>((resolve) => {
        let started = false;
        const finish = () => {
          clearTimers();
          setIsSpeaking(false);
          resolve();
        };

        try {
          const utterances = lines.map((text) => {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'en-US';
            u.rate = SPEECH_RATE;
            u.pitch = 1;
            return u;
          });
          const first = utterances[0]!;
          const last = utterances[utterances.length - 1]!;

          first.onstart = () => {
            started = true;
            speechWorksRef.current = true;
            if (startTimerRef.current !== null) {
              window.clearTimeout(startTimerRef.current);
              startTimerRef.current = null;
            }
            // Now that speech is really underway, arm a length-scaled end
            // watchdog in case onend never arrives.
            const totalLen = lines.join(' ').length;
            const estMs = (totalLen / SPEECH_RATE) * 90;
            endTimerRef.current = window.setTimeout(
              finish,
              Math.min(MAX_SPEECH_MS, Math.max(4000, estMs))
            );
          };
          last.onend = finish;
          last.onerror = finish;

          startTimerRef.current = window.setTimeout(() => {
            if (!started) {
              speechWorksRef.current = false; // give up on TTS for the rest of the session
              try {
                window.speechSynthesis.cancel();
              } catch {
                // ignore
              }
              finish();
            }
          }, START_GRACE_MS);

          for (const u of utterances) window.speechSynthesis.speak(u);
        } catch {
          finish();
        }
      });
    },
    [supported, clearTimers]
  );

  const speak = useCallback(
    (prefix: string, question: string) => {
      void run([prefix, question]);
    },
    [run]
  );

  /** Speak a single line; resolve when it finishes. Used for the wrong-answer reveal. */
  const speakLine = useCallback((text: string): Promise<void> => run([text]), [run]);

  /**
   * Prime the speech engine from within a user gesture (iOS requires this
   * before speak() outside a gesture will produce audio). Speaks a silent
   * blank so the user hears nothing.
   */
  const warmUp = useCallback(() => {
    if (!supported) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      // ignore
    }
  }, [supported]);

  // Stop speaking if muted mid-utterance (deferred a tick so we don't call
  // setState synchronously inside the effect body).
  useEffect(() => {
    if (!muted) return;
    const id = window.setTimeout(cancel, 0);
    return () => window.clearTimeout(id);
  }, [muted, cancel]);

  // Stop speaking when the post is scrolled away / backgrounded.
  useEffect(() => {
    if (!supported) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  return { supported, isSpeaking, speak, speakLine, warmUp, cancel };
}

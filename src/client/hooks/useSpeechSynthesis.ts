import { useCallback, useEffect, useRef, useState } from 'react';

const SPEECH_RATE = 0.82;
/** Safety cap in case an utterance's `onend` never fires (some webviews are flaky). */
const MAX_SPEECH_MS = 15000;

/**
 * Experimental clue read-aloud via the browser-built-in speechSynthesis.
 * Feature-detected: on webviews without support this is a silent no-op and
 * `isSpeaking` never becomes true, so callers never gate on it.
 *
 * The prefix ("Starts with G") and the clue are spoken as two separate
 * utterances — queuing them back to back gives a natural pause between the
 * two without relying on SSML (which plain speechSynthesis doesn't support).
 */
export function useSpeechSynthesis(muted: boolean) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const mutedRef = useRef(muted);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const clearWatchdog = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearWatchdog();
    if (supported) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [supported, clearWatchdog]);

  const speak = useCallback(
    (prefix: string, question: string) => {
      if (!supported || mutedRef.current) {
        setIsSpeaking(false);
        return;
      }
      window.speechSynthesis.cancel();
      clearWatchdog();
      setIsSpeaking(true);

      const finish = () => {
        clearWatchdog();
        setIsSpeaking(false);
      };

      try {
        const u1 = new SpeechSynthesisUtterance(prefix);
        const u2 = new SpeechSynthesisUtterance(question);
        for (const u of [u1, u2]) {
          u.lang = 'en-US';
          u.rate = SPEECH_RATE;
          u.pitch = 1;
        }
        u2.onend = finish;
        u2.onerror = finish;
        timeoutRef.current = window.setTimeout(finish, MAX_SPEECH_MS);
        window.speechSynthesis.speak(u1);
        window.speechSynthesis.speak(u2);
      } catch {
        finish();
      }
    },
    [supported, clearWatchdog]
  );

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

  return { supported, isSpeaking, speak, cancel };
}

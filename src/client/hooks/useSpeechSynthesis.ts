import { useCallback, useEffect, useRef, useState } from 'react';

const SPEECH_RATE = 0.82;
/** Safety cap in case an utterance's `onend` never fires (some webviews are flaky). */
const MAX_SPEECH_MS = 15000;

/**
 * Experimental clue read-aloud via the browser-built-in speechSynthesis.
 *
 * `'speechSynthesis' in window` alone is not a reliable feature check: many
 * embedded WebViews (notably Android's, which is what Reddit's mobile app
 * renders this game in) expose the API but have no actual TTS engine wired
 * in — speak() "succeeds" (fires onend) but no audio is ever produced. The
 * one signal that reliably correlates with a working engine is a non-empty
 * voice list, so `supported` additionally requires that.
 */
export function useSpeechSynthesis(muted: boolean) {
  const apiPresent = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [hasVoices, setHasVoices] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const mutedRef = useRef(muted);
  const timeoutRef = useRef<number | null>(null);

  const supported = apiPresent && hasVoices;

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Voice lists populate asynchronously in some browsers; broken WebViews
  // never populate one at all, which is exactly the case we want to detect.
  useEffect(() => {
    if (!apiPresent) return;
    const check = () => {
      if (window.speechSynthesis.getVoices().length > 0) setHasVoices(true);
    };
    check();
    window.speechSynthesis.addEventListener('voiceschanged', check);
    const timeout = window.setTimeout(check, 800);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', check);
      window.clearTimeout(timeout);
    };
  }, [apiPresent]);

  const clearWatchdog = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearWatchdog();
    if (apiPresent) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [apiPresent, clearWatchdog]);

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
        // Scale the watchdog to how much there is to say, so a genuinely
        // stuck utterance is caught faster than a flat worst-case timeout.
        const estimatedMs = ((prefix.length + question.length) / SPEECH_RATE) * 90;
        timeoutRef.current = window.setTimeout(finish, Math.min(MAX_SPEECH_MS, Math.max(4000, estimatedMs)));
        window.speechSynthesis.speak(u1);
        window.speechSynthesis.speak(u2);
      } catch {
        finish();
      }
    },
    [supported, clearWatchdog]
  );

  /**
   * Speak a single line and resolve when it finishes (or immediately if TTS
   * isn't usable). Used for the wrong-answer read-aloud, where the caller
   * wants to hold the reveal until speech completes.
   */
  const speakLine = useCallback(
    (text: string): Promise<void> => {
      if (!supported || mutedRef.current) return Promise.resolve();
      window.speechSynthesis.cancel();
      clearWatchdog();
      setIsSpeaking(true);

      return new Promise<void>((resolve) => {
        const finish = () => {
          clearWatchdog();
          setIsSpeaking(false);
          resolve();
        };
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'en-US';
          u.rate = SPEECH_RATE;
          u.pitch = 1;
          u.onend = finish;
          u.onerror = finish;
          const estimatedMs = (text.length / SPEECH_RATE) * 90;
          timeoutRef.current = window.setTimeout(
            finish,
            Math.min(MAX_SPEECH_MS, Math.max(4000, estimatedMs))
          );
          window.speechSynthesis.speak(u);
        } catch {
          finish();
        }
      });
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
    if (!apiPresent) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPresent]);

  return { supported, isSpeaking, speak, speakLine, cancel };
}

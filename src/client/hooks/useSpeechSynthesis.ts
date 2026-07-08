import { useCallback, useEffect, useRef } from 'react';

/**
 * Experimental question read-aloud via the browser-built-in speechSynthesis.
 * Feature-detected: on webviews without support this is a silent no-op.
 */
export function useSpeechSynthesis(muted: boolean) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const cancel = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || mutedRef.current) return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.05;
        window.speechSynthesis.speak(utterance);
      } catch {
        // silent fallback
      }
    },
    [supported]
  );

  // Stop speaking when muted or when the post is scrolled away.
  useEffect(() => {
    if (muted) cancel();
  }, [muted, cancel]);

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
  }, [supported, cancel]);

  return { supported, speak, cancel };
}

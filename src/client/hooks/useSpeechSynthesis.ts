import { useCallback, useEffect, useRef, useState } from 'react';

const SPEECH_RATE = 0.95;
/** Safety cap in case an utterance's `onend` never fires (some webviews are flaky). */
const MAX_SPEECH_MS = 15000;

/**
 * Ranked voice preferences, best first. The voice an engine hands out by
 * default is usually its flattest fallback (eSpeak-derived on Android
 * WebViews, "Fred" on macOS, the compact variants on iOS), which is where the
 * robotic quality comes from. Every engine also ships something far more
 * natural — it just has to be asked for by name.
 */
const PREFERRED_VOICES: RegExp[] = [
  // Cloud/neural tiers — the most natural thing available in a browser.
  /\b(neural|natural)\b/i,
  /^Google (US|UK) English/i,
  /^Google\b/i,
  /^Microsoft\b.*\b(Aria|Jenny|Guy|Michelle|Ana|Emma|Brian)\b/i,
  // Apple's downloadable high-quality variants, then its good built-in set.
  /\((Enhanced|Premium)\)/i,
  /^(Ava|Allison|Samantha|Serena|Karen|Moira|Tessa|Daniel|Nicky|Evan)\b/i,
];

/** Novelty and low-fidelity voices — never pick these over the default. */
const AVOID_VOICES: RegExp[] = [
  /espeak/i,
  /\bcompact\b/i,
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Fred|Good News|Hysterical|Jester|Junior|Kathy|Organ|Pipe Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i,
];

/**
 * Higher is better. Negative means "not usable" (not an English voice), in
 * which case we leave `utterance.voice` unset and let the engine decide.
 */
function scoreVoice(voice: SpeechSynthesisVoice): number {
  const lang = voice.lang.toLowerCase().replace('_', '-');
  if (!lang.startsWith('en')) return -1;

  let score = lang.startsWith('en-us') ? 30 : lang.startsWith('en-gb') ? 20 : 10;

  const rank = PREFERRED_VOICES.findIndex((pattern) => pattern.test(voice.name));
  if (rank >= 0) score += 100 - rank * 10;
  if (AVOID_VOICES.some((pattern) => pattern.test(voice.name))) score -= 80;
  // Server-backed voices are the higher-quality tier wherever both exist.
  if (!voice.localService) score += 15;
  if (voice.default) score += 5;

  return score;
}

function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = 0;
  for (const voice of voices) {
    const score = scoreVoice(voice);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}
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
 *
 * Voice quality: we never accept the engine's default voice blindly — see
 * `scoreVoice` — because the default is typically the most robotic one
 * installed.
 */
export function useSpeechSynthesis(muted: boolean) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const mutedRef = useRef(muted);
  const endTimerRef = useRef<number | null>(null);
  const startTimerRef = useRef<number | null>(null);
  // null = unknown, true = confirmed working, false = confirmed dead.
  const speechWorksRef = useRef<boolean | null>(null);
  // Best English voice this engine offers; null = use the engine default.
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Voice lists populate asynchronously and inconsistently: Chrome fills them
  // after a `voiceschanged` event, Safari fills them lazily on first read, and
  // some WebViews only ever answer after a tick. Re-pick on every signal.
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const refresh = () => {
      try {
        const voices = synth.getVoices();
        if (voices.length) voiceRef.current = pickBestVoice(voices);
      } catch {
        // keep the engine default
      }
    };
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    const retry = window.setTimeout(refresh, 300);
    return () => {
      synth.removeEventListener('voiceschanged', refresh);
      window.clearTimeout(retry);
    };
  }, [supported]);

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
            const voice = voiceRef.current;
            if (voice) {
              u.voice = voice;
              // Must match the voice, or some engines fall back to the default.
              u.lang = voice.lang;
            } else {
              u.lang = 'en-US';
            }
            u.rate = SPEECH_RATE;
            u.pitch = 1;
            u.volume = 1;
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
      // One utterance, not two: queued utterances restart the engine's prosody
      // and leave a dead gap between them. A sentence break gives a natural
      // pause after "Starts with G" and keeps the intonation continuous.
      void run([`${prefix}. ${question}`]);
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
      // Safari/WKWebView only populates the voice list once the engine has been
      // used, so this is the first point where a good voice can be chosen.
      const voices = window.speechSynthesis.getVoices();
      if (voices.length) voiceRef.current = pickBestVoice(voices);
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { runSpeechSequence } from './speechSequence';

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
  // Tie-break toward on-device voices: a server-backed voice can take longer to
  // start than the engine-is-dead deadline below, or produce nothing at all in
  // a WebView. Name rank still outranks this, so a genuinely better cloud voice
  // is still chosen where it works.
  if (voice.localService) score += 15;
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
 * How long to wait for `onstart` before deciding an attempt produced nothing.
 * iOS WKWebView (the Reddit iOS app) exposes speechSynthesis but frequently
 * produces no audio and fires no events; without a start deadline the UI would
 * sit on "Reading the clue…" until the end-watchdog fires seconds later.
 *
 * The first attempt gets the longer window because a chosen voice may need to
 * be loaded (or fetched, for server-backed voices) before it starts.
 */
const START_GRACE_MS = 2000;
/** Deadline for the retry on the engine's own default voice. */
const FALLBACK_GRACE_MS = 1200;

/**
 * Silence held between the letter prompt ("Starts with G") and the clue itself.
 * Deliberately long enough to be unmistakable — a host's beat, not a stumble.
 * It costs the turn roughly this much per letter, so it trades clock for
 * intelligibility; tune it here if that balance needs to change.
 */
const CLUE_GAP_MS = 900;

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
  // null = unknown, true = confirmed working, false = confirmed dead.
  const speechWorksRef = useRef<boolean | null>(null);
  // Best English voice this engine offers; null = use the engine default.
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // Set once a chosen voice has been proven silent — stops the voice refresh
  // below from handing the same broken voice back.
  const voiceRejectedRef = useRef(false);
  /**
   * Stops the in-flight sequence and settles its promise. Callers await speech
   * (the wrong-answer reveal holds the turn until the answer has been read), so
   * every path that stops speech must settle it — otherwise the awaiting caller
   * is stranded and the game hangs with the clock running.
   */
  const stopSequenceRef = useRef<(() => void) | null>(null);

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
      if (voiceRejectedRef.current) return;
      try {
        const voices = synth.getVoices();
        if (voices.length) voiceRef.current = pickBestVoice(voices);
      } catch {
        // keep the engine default
      }
    };
    refresh();
    // Not every WebView implements EventTarget on speechSynthesis; the timed
    // re-read below is the fallback when this isn't wired up.
    try {
      synth.addEventListener('voiceschanged', refresh);
    } catch {
      // ignore
    }
    const retry = window.setTimeout(refresh, 300);
    return () => {
      try {
        synth.removeEventListener('voiceschanged', refresh);
      } catch {
        // ignore
      }
      window.clearTimeout(retry);
    };
  }, [supported]);

  const cancel = useCallback(() => {
    if (supported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    setIsSpeaking(false);
    stopSequenceRef.current?.();
  }, [supported]);

  /**
   * Speak the given lines one at a time, with a real silence between them;
   * resolve when done, bailed, or skipped. The ordering and watchdogs live in
   * `runSpeechSequence`; this supplies the policy around them.
   */
  const run = useCallback(
    (lines: string[]): Promise<void> => {
      if (!supported || mutedRef.current) return Promise.resolve();
      // Known-dead engine: don't lock the UI, just reveal immediately.
      if (speechWorksRef.current === false) return Promise.resolve();

      // Settle any run this one supersedes, so its awaiter can't be stranded.
      stopSequenceRef.current?.();
      setIsSpeaking(true);

      const sequence = runSpeechSequence({
        lines,
        synth: window.speechSynthesis,
        Utterance: SpeechSynthesisUtterance,
        voice: voiceRef.current,
        rate: SPEECH_RATE,
        gapMs: CLUE_GAP_MS,
        startGraceMs: START_GRACE_MS,
        fallbackGraceMs: FALLBACK_GRACE_MS,
        maxSpeechMs: MAX_SPEECH_MS,
        onStarted: () => {
          speechWorksRef.current = true;
        },
        onVoiceRejected: () => {
          voiceRef.current = null;
          voiceRejectedRef.current = true;
        },
        onDead: () => {
          speechWorksRef.current = false; // skip TTS for the rest of the session
        },
      });
      stopSequenceRef.current = sequence.stop;

      return sequence.promise.then(() => {
        if (stopSequenceRef.current === sequence.stop) stopSequenceRef.current = null;
        setIsSpeaking(false);
      });
    },
    [supported]
  );

  const speak = useCallback(
    (prefix: string, question: string) => {
      // Two lines, so the letter prompt lands as its own phrase with a beat
      // after it. Merged into one utterance the clue runs straight on from
      // "Starts with G" and the whole thing is hard to follow.
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
      // Safari/WKWebView only populates the voice list once the engine has been
      // used, so this is the first point where a good voice can be chosen.
      if (!voiceRejectedRef.current) {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length) voiceRef.current = pickBestVoice(voices);
      }
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

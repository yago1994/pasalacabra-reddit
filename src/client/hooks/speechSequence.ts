/**
 * Speaks a list of lines one at a time with real silence between them.
 *
 * Kept free of React so the sequencing — which is fiddly, and which no amount
 * of type-checking can validate — can be exercised directly against a stubbed
 * engine. `useSpeechSynthesis` owns the policy (mute, voice choice, whether the
 * engine has been written off); this owns only the ordering and the watchdogs.
 *
 * Why sequential rather than queued: engines run queued utterances straight
 * into each other, so "Starts with G" and the clue come out as one run-on
 * phrase. Waiting for each line to end and then holding `gapMs` of silence is
 * the only way to get a beat the engine can't collapse.
 */
export type SpeechSequenceOptions = {
  lines: string[];
  synth: SpeechSynthesis;
  Utterance: typeof SpeechSynthesisUtterance;
  /** Preferred voice, or null to let the engine choose. */
  voice: SpeechSynthesisVoice | null;
  rate: number;
  /** Silence held between lines. */
  gapMs: number;
  /** How long the first line may take to start before the voice is suspect. */
  startGraceMs: number;
  /** How long the retry on the engine's default voice may take to start. */
  fallbackGraceMs: number;
  /** Ceiling on the per-line end-watchdog. */
  maxSpeechMs: number;
  /** A line actually started: the engine works. */
  onStarted: () => void;
  /** The preferred voice produced nothing; retrying on the engine default. */
  onVoiceRejected: () => void;
  /** Nothing works here, not even the default voice. */
  onDead: () => void;
};

export type SpeechSequence = {
  /** Resolves when every line has been spoken, written off, or stopped. */
  promise: Promise<void>;
  /** Stop speaking and settle `promise` now. Safe to call more than once. */
  stop: () => void;
};

/** Floor on the per-line end-watchdog, for lines too short to estimate well. */
const MIN_LINE_WATCHDOG_MS = 2500;

export function runSpeechSequence(options: SpeechSequenceOptions): SpeechSequence {
  const {
    lines,
    synth,
    Utterance,
    rate,
    gapMs,
    startGraceMs,
    fallbackGraceMs,
    maxSpeechMs,
    onStarted,
    onVoiceRejected,
    onDead,
  } = options;

  let voice = options.voice;
  let settled = false;
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let gapTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Bumped per line. `cancel()` makes some engines fire `onend` on the
   * utterance being discarded, so every handler checks it is still the current
   * one — otherwise a superseded line could settle the sequence or, worse,
   * advance it and speak again.
   */
  let generation = 0;

  const clearLineTimers = () => {
    if (startTimer !== null) {
      clearTimeout(startTimer);
      startTimer = null;
    }
    if (endTimer !== null) {
      clearTimeout(endTimer);
      endTimer = null;
    }
  };

  const clearAllTimers = () => {
    clearLineTimers();
    if (gapTimer !== null) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
  };

  const quietCancel = () => {
    try {
      synth.cancel();
    } catch {
      // ignore
    }
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    generation++; // invalidate anything still outstanding
    clearAllTimers();
    resolvePromise();
  };

  const stop = () => {
    if (settled) return;
    quietCancel();
    finish();
  };

  /**
   * Speak one line. `onDone` fires when it has finished (or been written off);
   * `onNoStart` fires if nothing began within `graceMs`.
   */
  const speakLine = (
    text: string,
    useVoice: boolean,
    graceMs: number,
    onNoStart: () => void,
    onDone: () => void
  ) => {
    const mine = ++generation;
    const stale = () => mine !== generation;
    clearLineTimers();
    quietCancel();
    let started = false;
    let done = false;

    // onend and the end-watchdog can both fire; only the first counts.
    const settleLine = () => {
      if (done || stale()) return;
      done = true;
      clearLineTimers();
      onDone();
    };

    try {
      const chosen = useVoice ? voice : null;
      const utterance = new Utterance(text);
      if (chosen) {
        utterance.voice = chosen;
        // Must match the voice or some engines ignore it. Normalized because a
        // few Android engines report tags as `en_US`.
        utterance.lang = chosen.lang.replace('_', '-');
      } else {
        utterance.lang = 'en-US';
      }
      utterance.rate = rate;
      utterance.pitch = 1;
      utterance.volume = 1;

      utterance.onstart = () => {
        if (stale()) return;
        started = true;
        onStarted();
        if (startTimer !== null) {
          clearTimeout(startTimer);
          startTimer = null;
        }
        // Speech is really underway; arm a length-scaled watchdog in case
        // `onend` never arrives.
        const estMs = (text.length / rate) * 90;
        endTimer = setTimeout(settleLine, Math.min(maxSpeechMs, Math.max(MIN_LINE_WATCHDOG_MS, estMs)));
      };
      utterance.onend = settleLine;
      utterance.onerror = settleLine;

      startTimer = setTimeout(() => {
        if (!stale() && !started) onNoStart();
      }, graceMs);

      synth.speak(utterance);
    } catch {
      if (!stale()) onNoStart();
    }
  };

  const giveUp = () => {
    onDead();
    quietCancel();
    finish();
  };

  let index = 0;
  const next = () => {
    if (settled) return;
    if (index >= lines.length) {
      finish();
      return;
    }
    const text = lines[index]!;
    const isFirstLine = index === 0;
    index++;

    const advance = () => {
      if (settled) return;
      if (index >= lines.length) {
        finish();
        return;
      }
      gapTimer = setTimeout(next, gapMs);
    };

    if (isFirstLine) {
      speakLine(
        text,
        true,
        startGraceMs,
        () => {
          // The preferred voice produced no audio and no events. Some WebViews
          // no-op on `utterance.voice` entirely, so before writing the engine
          // off, retry once on its own default voice — a robotic voice still
          // beats silence.
          if (voice) {
            voice = null;
            onVoiceRejected();
            speakLine(text, false, fallbackGraceMs, giveUp, advance);
          } else {
            giveUp();
          }
        },
        advance
      );
    } else {
      // The engine is proven by now; if a later line fails to start, move on
      // rather than stalling the read.
      speakLine(text, true, startGraceMs, advance, advance);
    }
  };

  next();

  return { promise, stop };
}

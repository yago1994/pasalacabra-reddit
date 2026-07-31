import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal shape of the Web Speech recognition API, declared locally: the
 * standard `SpeechRecognition` name is a recent and uneven addition to
 * lib.dom, and the `webkit`-prefixed constructor that most engines actually
 * ship has never been in it at all.
 */
type RecognitionAlternative = { readonly transcript: string };

type RecognitionResult = {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: RecognitionAlternative | undefined;
};

type RecognitionResultList = {
  readonly length: number;
  readonly [index: number]: RecognitionResult | undefined;
};

type RecognitionEventLike = { readonly results: RecognitionResultList };

type RecognitionErrorEventLike = { readonly error: string };

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => RecognitionLike;

/**
 * Errors that mean recognition will never work here, so the mic affordance
 * should disappear rather than keep failing:
 *  - `not-allowed` / `service-not-allowed`: the embedding page's permission
 *    policy blocks the microphone (the usual outcome inside an iframe that
 *    wasn't given `allow="microphone"`), or the user denied it;
 *  - `audio-capture`: no usable input device.
 * Everything else (`no-speech`, `aborted`, `network`) is transient.
 */
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Best transcript in the event, joining every result segment in order. */
function readTranscript(event: RecognitionEventLike): { text: string; isFinal: boolean } {
  let text = '';
  let isFinal = false;
  for (let i = 0; i < event.results.length; i++) {
    const result = event.results[i];
    if (!result) continue;
    text += result[0]?.transcript ?? '';
    if (result.isFinal) isFinal = true;
  }
  return { text: text.trim(), isFinal };
}

type Handlers = {
  /** Live partial transcript, for showing words as they land. */
  onInterim: (text: string) => void;
  /** Recognition settled on a phrase. */
  onFinal: (text: string) => void;
  /** Recognition is permanently unavailable here; drop the mic UI. */
  onUnavailable: () => void;
};

/**
 * Voice answers via the browser's built-in speech recognition.
 *
 * Availability can't be settled by feature detection alone — the constructor
 * exists in mobile WebViews where the microphone is blocked by permission
 * policy, and the block only surfaces as an error event after `start()`. So we
 * expose the mic while the constructor exists and retire it for the rest of
 * the session on the first fatal error, the same attempt-then-learn approach
 * `useSpeechSynthesis` uses for playback.
 */
export function useDictation(handlers: Handlers) {
  const [available, setAvailable] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);

  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const recognitionRef = useRef<RecognitionLike | null>(null);
  // Guards against the double-start that throws InvalidStateError: `listening`
  // state lags, and `onend` can arrive after a new start was already requested.
  const activeRef = useRef(false);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    activeRef.current = false;
    setListening(false);
    if (!recognition) return;
    try {
      recognition.abort();
    } catch {
      // already stopped
    }
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setAvailable(false);
      return;
    }

    let recognition: RecognitionLike;
    try {
      recognition = new Ctor();
    } catch {
      setAvailable(false);
      handlersRef.current.onUnavailable();
      return;
    }

    recognition.lang = 'en-US';
    // One phrase per turn: recognition ends itself on the trailing pause, which
    // is exactly the boundary we want to submit an answer on.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event) => {
      const { text, isFinal } = readTranscript(event);
      if (!text) return;
      if (isFinal) handlersRef.current.onFinal(text);
      else handlersRef.current.onInterim(text);
    };

    recognition.onerror = (event) => {
      if (FATAL_ERRORS.has(event.error)) {
        activeRef.current = false;
        setAvailable(false);
        setListening(false);
        handlersRef.current.onUnavailable();
      }
    };

    recognition.onend = () => {
      activeRef.current = false;
      setListening(false);
    };

    recognitionRef.current = recognition;
    activeRef.current = true;
    try {
      recognition.start();
    } catch {
      // Some engines throw synchronously when the mic is unavailable.
      activeRef.current = false;
      setListening(false);
      setAvailable(false);
      handlersRef.current.onUnavailable();
    }
  }, []);

  // Never leave the mic hot when the view goes away or is backgrounded.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [stop]);

  return { available, listening, start, stop };
}

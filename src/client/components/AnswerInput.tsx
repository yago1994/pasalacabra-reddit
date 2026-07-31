import { useCallback, useEffect, useRef, useState } from 'react';
import { useDictation } from '../hooks/useDictation';

type Props = {
  disabled: boolean;
  /** True while a clue is being read aloud — the mic must not hear the clue. */
  speaking: boolean;
  onGuess: (answer: string) => void;
  onPass: () => void;
};

const PASS_WORDS = new Set([
  'pasalacabra',
  'pasapalabra',
  'pasala',
  'pass',
  'skip',
  // How dictation engines tend to hear "pasalacabra".
  'passalacabra',
  'passthecabra',
  'pasalakabra',
]);

export function AnswerInput({ disabled, speaking, onGuess, onPass }: Props) {
  const [value, setValue] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      setValue('');
      if (PASS_WORDS.has(trimmed.toLowerCase().replace(/\s+/g, ''))) {
        onPass();
        return;
      }
      onGuess(trimmed);
    },
    [onGuess, onPass]
  );

  const {
    available: micAvailable,
    listening,
    start: startListening,
    stop: stopListening,
  } = useDictation({
    onInterim: setValue,
    onFinal: (text) => submit(text),
    onUnavailable: () => setVoiceMode(false),
  });

  // Keep focus so the keyboard stays up between questions on mobile.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  // Voice mode: take one listen per question, as soon as the turn opens and the
  // clue has finished being read. Deliberately not re-armed after recognition
  // ends on its own — a silent auto-restart loop would hold the mic for the
  // whole game — so the mic button stays tappable for a second try.
  useEffect(() => {
    if (!voiceMode || !micAvailable) return;
    if (disabled || speaking) {
      stopListening();
      return;
    }
    startListening();
  }, [voiceMode, disabled, speaking, micAvailable, startListening, stopListening]);

  const clear = () => {
    setValue('');
    stopListening();
    inputRef.current?.focus();
  };

  // Dictation is worth advertising in the placeholder: it costs no layout and
  // is the only hint players get. Where the web mic is blocked (Reddit's
  // in-app webview usually blocks it), the phone keyboard's own dictation key
  // still works, so point at that instead.
  const placeholder = listening
    ? 'Listening…'
    : micAvailable
      ? 'Type or tap 🎤 to speak'
      : 'Type, or tap 🎤 on your keyboard';

  return (
    <div className="flex w-full max-w-md items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            // A real keystroke wins over the mic: stop listening so interim
            // results can't overwrite what is being typed.
            if (listening) stopListening();
            setValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(value);
          }}
          placeholder={placeholder}
          autoCapitalize="off"
          // Autocorrect and spellcheck are what put the suggestion strip on the
          // phone keyboard; with them off there are no word suggestions at all.
          autoCorrect="on"
          autoComplete="off"
          spellCheck
          enterKeyHint="send"
          className={`w-full min-w-0 rounded-xl border bg-white/10 py-3 pr-10 pl-4 text-base text-white placeholder-white/40 outline-none disabled:opacity-50 ${
            listening ? 'border-rose-400' : 'border-white/20 focus:border-cyan-300'
          }`}
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            // Keep the on-screen keyboard from closing when the button is hit.
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Clear answer"
            title="Clear"
            className="absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-sm leading-none text-white/80 hover:bg-white/30"
          >
            ✕
          </button>
        )}
      </div>
      {micAvailable && (
        <button
          type="button"
          onClick={() => {
            const next = !voiceMode;
            setVoiceMode(next);
            if (next) startListening();
            else stopListening();
          }}
          disabled={disabled}
          aria-pressed={voiceMode}
          aria-label={voiceMode ? 'Turn off voice answers' : 'Answer by voice'}
          title="Answer by voice"
          className={`shrink-0 rounded-xl px-2.5 py-3 font-bold text-white transition-colors disabled:opacity-40 ${
            listening
              ? 'animate-pulse bg-rose-500'
              : voiceMode
                ? 'bg-rose-600/70'
                : 'bg-white/10 hover:bg-white/20'
          }`}
        >
          🎤
        </button>
      )}
      <button
        onClick={() => submit(value)}
        disabled={disabled || !value.trim()}
        className="shrink-0 rounded-xl bg-emerald-500 px-4 py-3 font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-40"
      >
        Go
      </button>
      <button
        onClick={() => {
          setValue('');
          stopListening();
          onPass();
        }}
        disabled={disabled}
        title="Pass — come back to this letter later"
        className="shrink-0 rounded-xl bg-sky-600 px-3 py-3 font-bold text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
      >
        Pasala🐐
      </button>
    </div>
  );
}

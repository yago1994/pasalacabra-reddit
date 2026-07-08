import { useEffect, useRef, useState } from 'react';

type Props = {
  disabled: boolean;
  onGuess: (answer: string) => void;
  onPass: () => void;
};

const PASS_WORDS = new Set(['pasalacabra', 'pasapalabra', 'pass', 'skip']);

export function AnswerInput({ disabled, onGuess, onPass }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep focus so the keyboard stays up between questions on mobile.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue('');
    if (PASS_WORDS.has(trimmed.toLowerCase().replace(/\s+/g, ''))) {
      onPass();
      return;
    }
    onGuess(trimmed);
  };

  return (
    <div className="flex w-full max-w-md gap-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Type your answer…"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="send"
        className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-base text-white placeholder-white/40 outline-none focus:border-cyan-300 disabled:opacity-50"
      />
      <button
        onClick={submit}
        disabled={disabled || !value.trim()}
        className="rounded-xl bg-emerald-500 px-4 py-3 font-bold text-white transition-colors hover:bg-emerald-400 disabled:opacity-40"
      >
        Go
      </button>
      <button
        onClick={() => {
          setValue('');
          onPass();
        }}
        disabled={disabled}
        title="Pass — come back to this letter later"
        className="rounded-xl bg-sky-600 px-3 py-3 font-bold text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
      >
        Pasala🐐
      </button>
    </div>
  );
}

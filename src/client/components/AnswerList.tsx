import type { AnswerReveal } from '../../shared/api';
import { cluePrefix } from '../../shared/letters';

function statusIcon(status: AnswerReveal['status']): string {
  switch (status) {
    case 'correct':
      return '🟢';
    case 'wrong':
      return '🔴';
    default:
      return '🔵';
  }
}

/** End-of-game review: every letter's clue and its correct answer. */
export function AnswerList({ answers }: { answers: AnswerReveal[] }) {
  return (
    <ul className="flex w-full max-w-md flex-col gap-1.5">
      {answers.map((a) => (
        <li
          key={a.letter}
          className="flex items-start gap-3 rounded-xl bg-white/8 px-3 py-2 text-left"
        >
          <span className="mt-0.5 text-lg leading-none">{statusIcon(a.status)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[0.7rem] font-bold tracking-wide text-cyan-300 uppercase">
              {cluePrefix(a.mode, a.letter)}
            </span>
            <span className="text-sm leading-snug text-white/70">{a.question}</span>
            <span className="text-sm font-bold text-white">{a.answer}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

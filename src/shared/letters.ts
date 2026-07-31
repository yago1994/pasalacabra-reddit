export const LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
] as const;

export type Letter = (typeof LETTERS)[number];

export type QuestionMode = 'starts' | 'contains';

/** A question as the client sees it: no answer. */
export type ClientQuestion = {
  letter: Letter;
  mode: QuestionMode;
  question: string;
};

/** Full question, server-side only. */
export type QA = ClientQuestion & {
  answer: string;
  alt?: string[];
};

export type LetterStatus = 'pending' | 'current' | 'passed' | 'correct' | 'wrong';

export type StatusByLetter = Record<Letter, LetterStatus>;

/** Fill colors per status, shared by the ring, badges, and canvas snapshot. */
export const STATUS_COLORS: Record<LetterStatus, string> = {
  pending: '#4f8dff',
  current: '#00d4ff',
  passed: '#4f8dff',
  correct: '#2bb673',
  wrong: '#ff4d4d',
};

export const TURN_SECONDS = 240;

/** Client-side pause after a wrong answer while the correct answer is shown. */
export const REVEAL_PAUSE_MS = 1800;

/**
 * The clock is meant to measure thinking time, not connection quality, so time
 * the player spent locked out waiting on the server is credited back to them.
 * Only the client can observe its own round trip, so it measures the stalls and
 * reports them; these bound how much of that report the server will believe.
 */
export const MAX_STALL_CREDIT_PER_ACTION_MS = 10_000;
export const MAX_STALL_CREDIT_TOTAL_MS = 60_000;

export function cluePrefix(mode: QuestionMode, letter: Letter): string {
  return mode === 'starts' ? `Starts with ${letter}` : `Contains ${letter}`;
}

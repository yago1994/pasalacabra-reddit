// Request/response types for every /api endpoint, shared by client and server.
import type { ClientQuestion, Letter, LetterStatus, QuestionMode, StatusByLetter } from './letters';

export type ApiError = { status: 'error'; message: string };

/** A revealed answer row, only ever sent once a game is finished. */
export type AnswerReveal = {
  letter: Letter;
  mode: QuestionMode;
  question: string;
  answer: string;
  status: LetterStatus;
};

export type LeaderboardRow = {
  username: string;
  correct: number;
  wrong: number;
  timeUsedSeconds: number;
  rank: number;
};

export type LeaderboardView = {
  top: LeaderboardRow[];
  me?: LeaderboardRow;
  totalPlayers: number;
};

export type GameResult = {
  correct: number;
  wrong: number;
  timeUsedSeconds: number;
  rank: number;
  totalPlayers: number;
  streak: number;
  maxStreak: number;
  shareText: string;
  statusByLetter: StatusByLetter;
  /** Full clue + correct answer for every letter (game is over, so safe to send). */
  answers: AnswerReveal[];
};

export type InProgressGame = {
  questions: ClientQuestion[];
  statusByLetter: StatusByLetter;
  currentIndex: number;
  secondsLeft: number;
};

export type InitResponse = {
  type: 'init';
  date: string; // YYYY-MM-DD of this post's puzzle
  gameNo: number;
  isToday: boolean;
  username: string | null;
  status: 'not_started' | 'in_progress' | 'finished';
  game?: InProgressGame;
  result?: GameResult;
  leaderboard: LeaderboardView;
  muted: boolean;
};

export type StartResponse = {
  type: 'start';
  questions: ClientQuestion[];
  statusByLetter: StatusByLetter;
  currentIndex: number;
  secondsLeft: number;
};

export type GuessRequest = { letter: string; answer: string };

export type GuessResponse = {
  type: 'guess';
  verdict: 'correct' | 'wrong';
  correctAnswer?: string; // revealed only on wrong
  statusByLetter: StatusByLetter;
  currentIndex: number;
  secondsLeft: number;
  finished: boolean;
  result?: GameResult;
};

export type PassRequest = { letter: string };

export type PassResponse = {
  type: 'pass';
  statusByLetter: StatusByLetter;
  currentIndex: number;
  secondsLeft: number;
};

export type FinishRequest = { reason: 'timeout' | 'gaveup' };

export type FinishResponse = {
  type: 'finish';
  result: GameResult;
};

export type LeaderboardResponse = {
  type: 'leaderboard';
  leaderboard: LeaderboardView;
};

export type ShareRequest = {
  /** PNG data URL of the results card, embedded into the comment when present. */
  imageDataUrl?: string;
};

export type ShareResponse = {
  type: 'share';
  posted: boolean;
  shareText: string;
};

export type PrefsRequest = { muted: boolean };
export type PrefsResponse = { type: 'prefs'; muted: boolean };

// Pure game logic shared by client (display) and server (authority).
import { LETTERS, type Letter, type LetterStatus, type StatusByLetter } from './letters';

export type GameState = {
  statusByLetter: StatusByLetter;
  currentIndex: number;
};

export type TurnEvent = { type: 'correct' } | { type: 'wrong' } | { type: 'pass' };

export function createInitialStatusByLetter(): StatusByLetter {
  const initial = {} as StatusByLetter;
  for (const l of LETTERS) initial[l] = 'pending';
  initial[LETTERS[0]] = 'current';
  return initial;
}

export function createInitialGameState(): GameState {
  return { statusByLetter: createInitialStatusByLetter(), currentIndex: 0 };
}

export function nextUnresolvedIndex(statusByLetter: StatusByLetter, startFrom: number): number {
  for (let offset = 1; offset <= LETTERS.length; offset++) {
    const idx = (startFrom + offset) % LETTERS.length;
    const status = statusByLetter[LETTERS[idx]!];
    if (status === 'pending' || status === 'passed' || status === 'current') return idx;
  }
  return -1;
}

export function ensureCurrentLetter(statusByLetter: StatusByLetter, currentIndex: number): StatusByLetter {
  const next = { ...statusByLetter };
  for (const l of LETTERS) {
    if (next[l] === 'current') next[l] = 'pending';
  }
  const cur = LETTERS[currentIndex];
  if (cur && next[cur] !== 'correct' && next[cur] !== 'wrong') next[cur] = 'current';
  return next;
}

export function anyUnresolved(statusByLetter: StatusByLetter): boolean {
  return LETTERS.some((l) => {
    const status = statusByLetter[l];
    return status === 'pending' || status === 'passed' || status === 'current';
  });
}

export function reduceTurn(state: GameState, event: TurnEvent): GameState {
  const curLetter = LETTERS[state.currentIndex];
  if (!curLetter) return state;

  const resolved: LetterStatus =
    event.type === 'correct' ? 'correct' : event.type === 'wrong' ? 'wrong' : 'passed';

  const statusByLetter = ensureCurrentLetter(
    { ...state.statusByLetter, [curLetter]: resolved },
    state.currentIndex
  );
  const nextIdx = nextUnresolvedIndex(statusByLetter, state.currentIndex);
  return {
    statusByLetter: nextIdx === -1 ? statusByLetter : ensureCurrentLetter(statusByLetter, nextIdx),
    currentIndex: nextIdx === -1 ? state.currentIndex : nextIdx,
  };
}

export function countStatuses(statusByLetter: StatusByLetter): {
  correct: number;
  wrong: number;
  unresolved: number;
} {
  let correct = 0;
  let wrong = 0;
  let unresolved = 0;
  for (const l of LETTERS) {
    const status = statusByLetter[l];
    if (status === 'correct') correct++;
    else if (status === 'wrong') wrong++;
    else unresolved++;
  }
  return { correct, wrong, unresolved };
}

export function currentLetterOf(state: GameState): Letter {
  return LETTERS[state.currentIndex]!;
}

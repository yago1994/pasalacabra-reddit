// Emoji share text for a finished daily game.
import { LETTERS, type StatusByLetter } from './letters';

function statusToEmoji(status: string): string {
  switch (status) {
    case 'correct':
      return '🟢';
    case 'wrong':
      return '🔴';
    default:
      return '🔵';
  }
}

export function buildShareText(
  statusByLetter: StatusByLetter,
  gameNo: number,
  timeUsedSeconds?: number
): string {
  let correct = 0;
  let wrong = 0;
  let skip = 0;
  for (const l of LETTERS) {
    const status = statusByLetter[l];
    if (status === 'correct') correct++;
    else if (status === 'wrong') wrong++;
    else skip++;
  }

  const lines: string[] = [];
  lines.push(`Pasala🐐 #${gameNo}`);
  const time =
    timeUsedSeconds !== undefined
      ? ` · ⏱️ ${Math.floor(timeUsedSeconds / 60)}:${String(timeUsedSeconds % 60).padStart(2, '0')}`
      : '';
  lines.push(`🟢 ${correct} · 🔴 ${wrong} · 🔵 ${skip}${time}`);
  lines.push('');

  // 26 letters in rows of 9 / 9 / 8 (emoji-only: Reddit comments are not monospace).
  const rows = [LETTERS.slice(0, 9), LETTERS.slice(9, 18), LETTERS.slice(18)];
  for (const row of rows) {
    lines.push(row.map((l) => statusToEmoji(statusByLetter[l])).join(''));
  }

  return lines.join('\n');
}

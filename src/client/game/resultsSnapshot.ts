// Canvas rendering of the shareable results card: title, a grid of colored
// letter badges, then the summary — mirroring the on-screen layout so the
// shared image matches what the player sees.
import { LETTERS, STATUS_COLORS, type StatusByLetter } from '../../shared/letters';

const BG = '#0b0f1a';

function drawBadgeGrid(
  ctx: CanvasRenderingContext2D,
  statusByLetter: StatusByLetter,
  top: number,
  width: number
): number {
  const perRow = 9;
  const badge = 54;
  const gap = 10;
  const rows = Math.ceil(LETTERS.length / perRow);

  for (let i = 0; i < LETTERS.length; i++) {
    const letter = LETTERS[i]!;
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const rowCount = Math.min(perRow, LETTERS.length - row * perRow);
    const rowWidth = rowCount * badge + (rowCount - 1) * gap;
    const startX = (width - rowWidth) / 2;
    const cx = startX + col * (badge + gap) + badge / 2;
    const cy = top + row * (badge + gap) + badge / 2;
    const r = badge / 2;

    ctx.save();
    ctx.fillStyle = STATUS_COLORS[statusByLetter[letter]];
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(badge * 0.5)}px system-ui, -apple-system, Segoe UI, Roboto`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, cx, cy + 1);
    ctx.restore();
  }

  return top + rows * badge + (rows - 1) * gap; // bottom Y
}

export type SnapshotStats = {
  gameNo: number;
  correct: number;
  wrong: number;
  timeUsedSeconds: number;
  rank?: number;
  totalPlayers?: number;
  streak?: number;
};

export function renderResultsSnapshot(
  canvas: HTMLCanvasElement,
  statusByLetter: StatusByLetter,
  stats: SnapshotStats
): void {
  const width = 640;
  const height = 520;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';

  // Title.
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 44px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Pasala🐐 #${stats.gameNo}`, width / 2, 70);

  // Letters, then summary below them.
  const gridBottom = drawBadgeGrid(ctx, statusByLetter, 110, width);

  const skip = LETTERS.length - stats.correct - stats.wrong;
  const m = Math.floor(stats.timeUsedSeconds / 60);
  const s = stats.timeUsedSeconds % 60;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 30px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText(
    `🟢 ${stats.correct}   🔴 ${stats.wrong}   🔵 ${skip}   ⏱️ ${m}:${String(s).padStart(2, '0')}`,
    width / 2,
    gridBottom + 56
  );

  let y = gridBottom + 100;
  if (stats.rank && stats.totalPlayers) {
    ctx.fillStyle = '#00d4ff';
    ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(`Rank #${stats.rank} of ${stats.totalPlayers} today`, width / 2, y);
    y += 40;
  }
  if (stats.streak && stats.streak > 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(`🔥 ${stats.streak}-day streak`, width / 2, y);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '600 18px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText('r/pasalacabra', width / 2, height - 20);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

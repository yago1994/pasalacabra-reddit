// Canvas rendering of the results card (ring + stats), ported from the
// original Pasalacabra's snapshotComposer.ts `drawRing`, minus the camera
// video composition (not available in the Devvit webview).
import { LETTERS, type LetterStatus, type StatusByLetter } from '../../shared/letters';

const COLORS = {
  bg: '#0b0f1a',
  current: '#00d4ff',
  correct: '#2bb673',
  wrong: '#ff4d4d',
  passed: '#4f8dff',
  default: '#4f8dff',
  dotStroke: 'rgba(255,255,255,0.35)',
  letter: 'rgba(255,255,255,0.98)',
} as const;

function fillForStatus(status: LetterStatus): string {
  switch (status) {
    case 'correct':
      return COLORS.correct;
    case 'wrong':
      return COLORS.wrong;
    default:
      return COLORS.default;
  }
}

function drawRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, statusByLetter: StatusByLetter) {
  const radius = size * 0.36;
  const dotR = size * 0.036;
  const step = (Math.PI * 2) / LETTERS.length;
  const start = -Math.PI / 2;

  for (let i = 0; i < LETTERS.length; i++) {
    const letter = LETTERS[i]!;
    const angle = start + i * step;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const fill = fillForStatus(statusByLetter[letter]);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(x + 1, y + 2, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = COLORS.dotStroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = COLORS.letter;
    ctx.font = `700 ${Math.round(size * 0.032)}px system-ui, -apple-system, Segoe UI, Roboto`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, x, y);
    ctx.restore();
  }
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
  const height = 800;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 40px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText(`Pasala🐐 #${stats.gameNo}`, width / 2, 74);

  const m = Math.floor(stats.timeUsedSeconds / 60);
  const s = stats.timeUsedSeconds % 60;
  ctx.font = '600 26px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(
    `🟢 ${stats.correct} · 🔴 ${stats.wrong} · ⏱️ ${m}:${String(s).padStart(2, '0')}`,
    width / 2,
    118
  );

  drawRing(ctx, width / 2, height / 2 + 20, Math.min(width, height) - 120, statusByLetter);

  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillStyle = '#00d4ff';
  if (stats.rank && stats.totalPlayers) {
    ctx.fillText(`Rank #${stats.rank} of ${stats.totalPlayers} today`, width / 2, height - 90);
  }
  if (stats.streak && stats.streak > 1) {
    ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`🔥 ${stats.streak}-day streak`, width / 2, height - 56);
  }

  ctx.font = '600 18px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('r/pasalacabra', width / 2, height - 20);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

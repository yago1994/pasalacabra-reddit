// Canvas rendering of the shareable results card: a ring of colored letter
// circles, echoing the original Pasalacabra board. No summary or rank is baked
// in — those live in the results UI and the comment caption.
import { LETTERS, STATUS_COLORS, type StatusByLetter } from '../../shared/letters';

const BG = '#0b0f1a';

export function renderResultsSnapshot(
  canvas: HTMLCanvasElement,
  statusByLetter: StatusByLetter,
  gameNo: number
): void {
  const width = 620;
  const height = 700;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';

  // Title.
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 46px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Pasala🐐 #${gameNo}`, width / 2, 64);

  // Ring of letter circles.
  const cx = width / 2;
  const cy = 380;
  const radius = 240;
  const dotR = 30;
  const step = (Math.PI * 2) / LETTERS.length;
  const start = -Math.PI / 2; // A at the top

  ctx.textBaseline = 'middle';
  for (let i = 0; i < LETTERS.length; i++) {
    const letter = LETTERS[i]!;
    const angle = start + i * step;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    ctx.save();
    ctx.fillStyle = STATUS_COLORS[statusByLetter[letter]];
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 30px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(letter, x, y + 1);
  }

  // Goat in the middle, echoing the mascot.
  ctx.font = '110px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText('🐐', cx, cy + 4);

  // Footer.
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '600 20px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText('r/pasalacabra', width / 2, height - 22);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

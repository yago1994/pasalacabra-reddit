import { LETTERS, type StatusByLetter, type LetterStatus } from '../../shared/letters';
import { useTweenedGoat } from './useTweenedGoat';

function statusToFill(status: LetterStatus): string {
  switch (status) {
    case 'current':
      return 'var(--letter-current)';
    case 'correct':
      return 'var(--letter-correct)';
    case 'wrong':
      return 'var(--letter-wrong)';
    case 'passed':
      return 'var(--letter-passed)';
    default:
      return 'var(--letter-default)';
  }
}

type Props = {
  statusByLetter: StatusByLetter;
  currentIndex: number;
};

const TAU = Math.PI * 2;

function angleForIndex(i: number, total: number) {
  return (i / total) * TAU - Math.PI / 2; // letters[0] at the top
}

export function LetterRing({ statusByLetter, currentIndex }: Props) {
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const ringR = 178;
  const nodeR = 17;
  const emojiSize = 52;

  const hasCurrent = currentIndex >= 0 && currentIndex < LETTERS.length;
  const currentAngle = hasCurrent ? angleForIndex(currentIndex, LETTERS.length) : 0;
  const currentX = cx + ringR * Math.cos(currentAngle);
  const currentY = cy + ringR * Math.sin(currentAngle);

  const goatOffset = nodeR + emojiSize / 2 - 8;
  const goatX = currentX + goatOffset * Math.cos(currentAngle);
  const goatY = currentY + goatOffset * Math.sin(currentAngle);
  const goatRotationDeg = (currentAngle - Math.PI / 2) * (180 / Math.PI);

  const anim = useTweenedGoat({ x: goatX, y: goatY, rot: goatRotationDeg }, 220);
  const goatTransform = `translate(${anim.x} ${anim.y}) rotate(${anim.rot}) scale(1 -1)`;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      height="100%"
      aria-label="Ring of letters"
      className="overflow-visible select-none"
    >
      {LETTERS.map((letter, i) => {
        const angle = angleForIndex(i, LETTERS.length);
        const x = cx + ringR * Math.cos(angle);
        const y = cy + ringR * Math.sin(angle);
        const status = statusByLetter[letter];
        return (
          <g key={letter}>
            <circle cx={x} cy={y} r={nodeR} fill={statusToFill(status)} opacity={0.95} />
            <circle
              cx={x}
              cy={y}
              r={nodeR}
              fill="transparent"
              stroke={status === 'current' ? 'rgb(255,255,255)' : 'rgba(255,255,255,0.35)'}
              strokeWidth="2"
            />
            <text
              x={x}
              y={y + 5.5}
              textAnchor="middle"
              fontSize="15"
              fontWeight="800"
              fill="rgba(255,255,255,0.98)"
            >
              {letter}
            </text>
          </g>
        );
      })}

      {hasCurrent && (
        <g transform={goatTransform}>
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={emojiSize}
            className="select-none pointer-events-none"
          >
            🐐
          </text>
        </g>
      )}
    </svg>
  );
}

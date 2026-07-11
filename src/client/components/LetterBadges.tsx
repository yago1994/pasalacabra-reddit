import { LETTERS, STATUS_COLORS, type Letter, type LetterStatus } from '../../shared/letters';

/**
 * A single colored circle with its letter embedded — our own SVG stand-in for
 * a status "emoji", since no emoji can carry the letter inside it.
 */
export function LetterBadge({
  letter,
  status,
  size = 30,
}: {
  letter: Letter;
  status: LetterStatus;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label={`${letter}: ${status}`}
      className="shrink-0"
    >
      <circle cx="16" cy="16" r="15" fill={STATUS_COLORS[status]} />
      <circle cx="16" cy="16" r="15" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="16"
        fontWeight="800"
        fill="#ffffff"
        fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      >
        {letter}
      </text>
    </svg>
  );
}

/** The full A–Z row of letter badges, wrapping as needed. */
export function LetterBadges({
  statusByLetter,
  size = 30,
}: {
  statusByLetter: Record<Letter, LetterStatus>;
  size?: number;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {LETTERS.map((letter) => (
        <LetterBadge key={letter} letter={letter} status={statusByLetter[letter]} size={size} />
      ))}
    </div>
  );
}

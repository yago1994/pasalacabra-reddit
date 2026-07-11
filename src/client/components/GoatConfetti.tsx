import { useEffect, useState } from 'react';

type Goat = { id: number; left: number; delay: number };

const GOAT_COUNT = 60;
const DELAY_SPREAD_SECONDS = 6;

function spawnGoats(): Goat[] {
  return Array.from({ length: GOAT_COUNT }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * DELAY_SPREAD_SECONDS,
  }));
}

/** Falling goat confetti on game over, ported from the original app's effect. */
export function GoatConfetti() {
  const [goats] = useState<Goat[]>(spawnGoats);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const cleanup = window.setTimeout(() => setVisible(false), (DELAY_SPREAD_SECONDS + 3) * 1000);
    return () => window.clearTimeout(cleanup);
  }, []);

  if (!visible) return null;

  return (
    <>
      {goats.map((goat) => (
        <div
          key={goat.id}
          className="goat-confetti"
          style={{ left: `${goat.left}%`, animationDelay: `${goat.delay}s` }}
          aria-hidden="true"
        >
          🐐
        </div>
      ))}
    </>
  );
}

import { useEffect, useRef, useState } from 'react';

export type Tween = { x: number; y: number; rot: number };

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** Smoothly animates (x, y, rot) towards a target using requestAnimationFrame. */
export function useTweenedGoat(target: Tween, durationMs = 220) {
  const [v, setV] = useState<Tween>(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = v;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = easeOutCubic(t);
      setV({
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        rot: from.rot + (target.rot - from.rot) * k,
      });
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.x, target.y, target.rot, durationMs]);

  return v;
}

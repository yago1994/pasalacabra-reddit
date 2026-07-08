// Answer comparison, ported from the original Pasalacabra with English articles
// and a token match instead of a raw substring check.

export function removeDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeForCompare(raw: string): string {
  const s = removeDiacritics(raw)
    .toLowerCase()
    .replace(/[¡!¿?.,;:()[\]{}"“”'’`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip leading English articles so "the sun" matches "sun".
  return s.replace(/^(the|a|an)\s+/i, '').trim();
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  const maxLen = Math.max(n, m);

  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return 1 - prev[m]! / maxLen;
}

function matchesSingle(given: string, expected: string): boolean {
  const s = normalizeForCompare(given);
  const e = normalizeForCompare(expected);
  if (!s || !e) return false;
  if (s === e) return true;

  // Multi-word answers: accept if every expected token appears in the guess
  // ("marie curie" accepts "madame marie curie") — but not for single tokens,
  // where substring matching would be too permissive.
  const sTokens = s.split(' ');
  const eTokens = e.split(' ');
  if (eTokens.length > 1 && eTokens.every((t) => sTokens.includes(t))) return true;
  if (eTokens.length === 1 && sTokens.length > 1 && sTokens.includes(e)) return true;

  // Small plural/singular tolerance.
  if (s === `${e}s` || e === `${s}s`) return true;
  if (s === `${e}es` || e === `${s}es`) return true;

  // Typo tolerance for single words (mobile keyboards).
  const sOneWord = sTokens.length === 1;
  const eOneWord = eTokens.length === 1;
  if (sOneWord && eOneWord && s.length >= 4 && e.length >= 4) {
    if (levenshteinRatio(s, e) >= 0.75) return true;
  }

  return false;
}

export function isAnswerCorrect(given: string, expected: string, alt?: string[]): boolean {
  if (matchesSingle(given, expected)) return true;
  return (alt ?? []).some((a) => matchesSingle(given, a));
}

// Fetches a pre-generated daily question set from an S3-hosted JSON file.
// SERVER-SIDE ONLY — the fetched JSON contains answers.
//
// Generation happens entirely in GitHub Actions (see the sibling `pasalacabra`
// repo), which uploads the result to S3. This module just pulls
// `<base>/daily/<date>.json`, validates it defensively, and hands back a
// SetDefinition. It never falls back to a static set — a missing/invalid file
// throws so the failure is visible, not silent.
import { settings } from '@devvit/web/server';
import { LETTERS } from '../../shared/letters';
import type { QA } from '../../shared/letters';
import type { SetDefinition } from '../data/sets';

export const DAILY_SETS_BASE_URL_SETTING = 'daily-sets-base-url';

/** The configured remote base URL, or undefined when running in dev (no key). */
export async function getDailySetsBaseUrl(): Promise<string | undefined> {
  const base = await settings.get<string>(DAILY_SETS_BASE_URL_SETTING);
  const trimmed = base?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : undefined;
}

const VALID_MODES = new Set(['starts', 'contains']);

/** Throws unless `raw` is a well-formed SetDefinition for the full A–Z ring. */
function validateSet(raw: unknown, date: string): SetDefinition {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`daily set for ${date}: not an object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id.trim()) {
    throw new Error(`daily set for ${date}: missing/invalid id`);
  }
  const questions = obj.questions;
  if (!Array.isArray(questions) || questions.length !== LETTERS.length) {
    throw new Error(`daily set for ${date}: expected ${LETTERS.length} questions`);
  }

  const seen = new Set<string>();
  questions.forEach((q, i) => {
    if (typeof q !== 'object' || q === null) {
      throw new Error(`daily set for ${date}: question ${i} not an object`);
    }
    const { letter, mode, question, answer, alt } = q as Record<string, unknown>;
    if (letter !== LETTERS[i]) {
      throw new Error(`daily set for ${date}: letter ${i} expected ${LETTERS[i]}, got ${String(letter)}`);
    }
    if (typeof mode !== 'string' || !VALID_MODES.has(mode)) {
      throw new Error(`daily set for ${date}: letter ${LETTERS[i]} has invalid mode ${String(mode)}`);
    }
    if (typeof question !== 'string' || !question.trim()) {
      throw new Error(`daily set for ${date}: letter ${LETTERS[i]} has empty question`);
    }
    if (typeof answer !== 'string' || !answer.trim()) {
      throw new Error(`daily set for ${date}: letter ${LETTERS[i]} has empty answer`);
    }
    if (alt !== undefined && !(Array.isArray(alt) && alt.every((a) => typeof a === 'string'))) {
      throw new Error(`daily set for ${date}: letter ${LETTERS[i]} has invalid alt`);
    }
    const key = answer.trim().toLowerCase();
    if (seen.has(key)) {
      throw new Error(`daily set for ${date}: duplicate answer "${answer}"`);
    }
    seen.add(key);
  });

  return { id: obj.id, questions: questions as QA[] };
}

/**
 * Fetch and validate the remote daily set for `date` (YYYY-MM-DD).
 * Throws on network error, non-200 (e.g. the file was never generated), or a
 * malformed payload.
 */
export async function fetchDailySet(base: string, date: string): Promise<SetDefinition> {
  const url = `${base}/daily/${date}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`daily set fetch ${url} failed: HTTP ${res.status}`);
  }
  const raw = (await res.json()) as unknown;
  return validateSet(raw, date);
}

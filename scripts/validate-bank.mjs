#!/usr/bin/env node
/**
 * Validates the Pasalacabra question bank in src/server/data/sets/set-*.json.
 *
 * Checks per set:
 *   - exactly 26 questions, letters A-Z each exactly once, in order
 *   - mode is "starts" | "contains"
 *   - answer satisfies the mode (normalized: lowercase, accents stripped)
 *   - every alt satisfies the mode too
 *   - normalized answer does not appear as a substring of the normalized question
 *   - answer length >= 3, question length <= 160
 * Across all sets:
 *   - no duplicate normalized answers
 *
 * Exits 0 with a per-set summary when clean; exits 1 listing all violations.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const setsDir = path.resolve(scriptDir, '..', 'src', 'server', 'data', 'sets');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const MODES = new Set(['starts', 'contains']);

/** Lowercase and strip accents/diacritics. */
function normalize(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Check that a candidate answer satisfies the mode for a letter. Returns null or an error string. */
function checkMode(candidate, mode, letter) {
  const norm = normalize(candidate);
  const l = letter.toLowerCase();
  if (mode === 'starts') {
    if (norm[0] !== l) return `"${candidate}" does not start with "${letter}"`;
    return null;
  }
  // contains
  if (!norm.includes(l)) return `"${candidate}" does not contain "${letter}"`;
  if (norm[0] === l) return `"${candidate}" starts with "${letter}" but mode is "contains"`;
  return null;
}

const files = readdirSync(setsDir)
  .filter((f) => /^set-\d+\.json$/.test(f))
  .sort();

if (files.length === 0) {
  console.error(`No set-*.json files found in ${setsDir}`);
  process.exit(1);
}

const violations = [];
const answersSeen = new Map(); // normalized answer -> "set-id letter"
const summaries = [];

for (const file of files) {
  const filePath = path.join(setsDir, file);
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    violations.push(`${file}: invalid JSON (${err.message})`);
    continue;
  }

  const setId = data.id ?? file;
  const questions = Array.isArray(data.questions) ? data.questions : null;
  if (!questions) {
    violations.push(`${file}: missing "questions" array`);
    continue;
  }
  if (questions.length !== 26) {
    violations.push(`${file}: expected 26 questions, found ${questions.length}`);
  }

  let starts = 0;
  let contains = 0;

  questions.forEach((q, i) => {
    const where = `${file} [${i}] letter=${q?.letter ?? '?'}`;

    // Letter sequence: A-Z in order, each exactly once.
    if (i < LETTERS.length && q.letter !== LETTERS[i]) {
      violations.push(`${where}: expected letter "${LETTERS[i]}" at position ${i}, found "${q.letter}"`);
    }

    if (!MODES.has(q.mode)) {
      violations.push(`${where}: invalid mode "${q.mode}"`);
      return;
    }
    if (q.mode === 'starts') starts += 1;
    else contains += 1;

    if (typeof q.question !== 'string' || typeof q.answer !== 'string') {
      violations.push(`${where}: question and answer must be strings`);
      return;
    }

    // Mode check for answer and alts.
    const modeErr = checkMode(q.answer, q.mode, q.letter);
    if (modeErr) violations.push(`${where}: ${modeErr}`);
    if (q.alt !== undefined) {
      if (!Array.isArray(q.alt)) {
        violations.push(`${where}: alt must be an array`);
      } else {
        for (const alt of q.alt) {
          const altErr = checkMode(alt, q.mode, q.letter);
          if (altErr) violations.push(`${where}: alt ${altErr}`);
        }
      }
    }

    // Answer must not leak into the question.
    const normAnswer = normalize(q.answer);
    const normQuestion = normalize(q.question);
    if (normQuestion.includes(normAnswer)) {
      violations.push(`${where}: answer "${q.answer}" appears in the question text`);
    }

    // Lengths.
    if (q.answer.length < 3) {
      violations.push(`${where}: answer "${q.answer}" is shorter than 3 characters`);
    }
    if (q.question.length > 160) {
      violations.push(`${where}: question is ${q.question.length} chars (max 160)`);
    }

    // Cross-set duplicate answers.
    const prev = answersSeen.get(normAnswer);
    if (prev) {
      violations.push(`${where}: duplicate answer "${q.answer}" (already used in ${prev})`);
    } else {
      answersSeen.set(normAnswer, `${setId} ${q.letter}`);
    }
  });

  summaries.push(
    `${setId}: ${questions.length} questions, ${starts} starts / ${contains} contains`
  );
}

console.log('Per-set summary:');
for (const line of summaries) console.log(`  ${line}`);
console.log(`  total unique answers: ${answersSeen.size}`);

if (violations.length > 0) {
  console.error(`\n${violations.length} violation(s):`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('\nAll sets valid.');

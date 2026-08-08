import { runSpeechSequence } from './speechSequence.ts';

const GAP = 300;

/**
 * Fake engine. `speakDurationMs` per line; `silent` makes speak() a no-op that
 * fires no events at all, which is the WebView failure we care about.
 */
function makeEngine({ speakDurationMs = 80, silentWhenVoiceSet = false, alwaysSilent = false } = {}) {
  const log = [];
  const t0 = Date.now();
  const stamp = (kind, text, extra = {}) => log.push({ kind, text, at: Date.now() - t0, ...extra });

  class Utterance {
    constructor(text) {
      this.text = text;
      this.voice = null;
      this.lang = '';
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }

  let current = null;
  const synth = {
    speak(u) {
      stamp('speak', u.text, { lang: u.lang, voiceName: u.voice?.name ?? null, rate: u.rate });
      const silent = alwaysSilent || (silentWhenVoiceSet && u.voice !== null);
      if (silent) return; // no audio, no events — exactly the broken-WebView case
      current = u;
      setTimeout(() => {
        stamp('start', u.text);
        u.onstart?.();
      }, 5);
      setTimeout(() => {
        stamp('end', u.text);
        current = null;
        u.onend?.();
      }, speakDurationMs);
    },
    cancel() {
      current = null;
    },
  };

  return { synth, Utterance, log };
}

const VOICE = { name: 'Test Voice', lang: 'en_US', localService: true, default: true };

function baseOptions(engine, overrides = {}) {
  const events = [];
  return {
    options: {
      lines: ['Starts with G', 'Tallest living land animal.'],
      synth: engine.synth,
      Utterance: engine.Utterance,
      voice: VOICE,
      rate: 0.95,
      gapMs: GAP,
      startGraceMs: 400,
      fallbackGraceMs: 300,
      maxSpeechMs: 15000,
      onStarted: () => events.push('started'),
      onVoiceRejected: () => events.push('voiceRejected'),
      onDead: () => events.push('dead'),
      ...overrides,
    },
    events,
  };
}

let failures = 0;
function check(label, condition, detail) {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------- test 1
console.log('\n1. Two lines are spoken sequentially with a real gap');
{
  const engine = makeEngine({ speakDurationMs: 80 });
  const { options, events } = baseOptions(engine);
  const seq = runSpeechSequence(options);
  await seq.promise;

  const speaks = engine.log.filter((e) => e.kind === 'speak');
  const firstEnd = engine.log.find((e) => e.kind === 'end');
  const secondSpeak = speaks[1];

  check('both lines spoken', speaks.length === 2, `${speaks.length} speak() calls`);
  check(
    'second line is the clue',
    secondSpeak?.text === 'Tallest living land animal.',
    secondSpeak?.text
  );
  const measuredGap = secondSpeak.at - firstEnd.at;
  check(
    `gap >= ${GAP}ms of real silence`,
    measuredGap >= GAP,
    `measured ${measuredGap}ms between line 1 ending and line 2 starting`
  );
  check(
    'lang normalized from the voice\'s en_US to en-US',
    speaks.every((s) => s.lang === 'en-US'),
    speaks.map((s) => s.lang).join(', ')
  );
  check(
    'preferred voice applied to every line',
    speaks.every((s) => s.voiceName === 'Test Voice'),
    speaks.map((s) => s.voiceName).join(', ')
  );
  check('rate passed through', speaks.every((s) => s.rate === 0.95));
  check('engine reported working', events.includes('started'));
  check('no false voice rejection', !events.includes('voiceRejected'));
  check('not marked dead', !events.includes('dead'));
}

// ---------------------------------------------------------------- test 2
console.log('\n2. A silent preferred voice falls back to the engine default');
{
  const engine = makeEngine({ speakDurationMs: 80, silentWhenVoiceSet: true });
  const { options, events } = baseOptions(engine);
  const seq = runSpeechSequence(options);
  await seq.promise;

  const speaks = engine.log.filter((e) => e.kind === 'speak');
  check('voice rejected', events.includes('voiceRejected'));
  check('not written off as dead', !events.includes('dead'));
  check(
    'line 1 retried, then line 2 spoken',
    speaks.length === 3 && speaks[2].text === 'Tallest living land animal.',
    `${speaks.length} speak() calls: ${speaks.map((s) => s.text).join(' | ')}`
  );
  const retryEnd = engine.log.find((e) => e.kind === 'end');
  const clueSpeak = speaks[2];
  check(
    `gap preserved after the fallback retry (>= ${GAP}ms)`,
    clueSpeak.at - retryEnd.at >= GAP,
    `measured ${clueSpeak.at - retryEnd.at}ms`
  );
  check(
    'retry and clue both drop the rejected voice',
    speaks[1].voiceName === null && speaks[2].voiceName === null,
    `retry=${speaks[1].voiceName}, clue=${speaks[2].voiceName}`
  );
}

// ---------------------------------------------------------------- test 3
console.log('\n3. A totally dead engine resolves instead of hanging');
{
  const engine = makeEngine({ alwaysSilent: true });
  const { options, events } = baseOptions(engine);
  const started = Date.now();
  const seq = runSpeechSequence(options);
  await seq.promise;
  check('promise resolved', true, `after ${Date.now() - started}ms`);
  check('marked dead', events.includes('dead'));
  check('never reported working', !events.includes('started'));
}

// ---------------------------------------------------------------- test 4
console.log('\n4. stop() settles the promise and speaks nothing further');
{
  const engine = makeEngine({ speakDurationMs: 5000 });
  const { options } = baseOptions(engine);
  const seq = runSpeechSequence(options);
  setTimeout(() => seq.stop(), 50);
  const started = Date.now();
  await seq.promise;
  const elapsed = Date.now() - started;
  check('resolved promptly on stop', elapsed < 500, `${elapsed}ms`);
  const before = engine.log.filter((e) => e.kind === 'speak').length;
  await new Promise((r) => setTimeout(r, GAP + 200));
  const after = engine.log.filter((e) => e.kind === 'speak').length;
  check('no further lines spoken after stop', before === after, `${before} -> ${after}`);
}

// ---------------------------------------------------------------- test 5
console.log('\n5. stop() during the inter-line gap also settles');
{
  const engine = makeEngine({ speakDurationMs: 60 });
  const { options } = baseOptions(engine);
  const seq = runSpeechSequence(options);
  // Land inside the gap: after line 1 ends (~60ms), before line 2 (~360ms).
  setTimeout(() => seq.stop(), 150);
  const started = Date.now();
  await seq.promise;
  check('resolved during gap', Date.now() - started < 400, `${Date.now() - started}ms`);
  const before = engine.log.filter((e) => e.kind === 'speak').length;
  await new Promise((r) => setTimeout(r, GAP + 200));
  const after = engine.log.filter((e) => e.kind === 'speak').length;
  check('gap timer cancelled, line 2 never spoken', before === after && before === 1, `${before} -> ${after}`);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

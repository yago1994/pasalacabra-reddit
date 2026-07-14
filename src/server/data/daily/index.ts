// Date-keyed daily puzzle overrides bundled with the app.
// SERVER-SIDE ONLY — these files contain answers.
//
// STOPGAP while the remote (S3) daily-set fetch is pending Reddit's HTTP
// domain approval. To serve a specific day's set without the `http`
// permission: drop that day's `<YYYY-MM-DD>.json` file (same shape as the
// remote daily files) in this folder, add an import + map entry below, and
// deploy. A date present here takes precedence over the remote fetch, so no
// network access is needed to serve it.
//
// Once the remote fetch is approved, stop adding files here and the map goes
// empty — the app falls back to remote fetch / bundled rotation automatically.
import type { SetDefinition } from '../sets';

import d20260711 from './2026-07-11.json';

export const DAILY_SETS: Record<string, SetDefinition> = {
  '2026-07-11': d20260711,
} as Record<string, SetDefinition>;

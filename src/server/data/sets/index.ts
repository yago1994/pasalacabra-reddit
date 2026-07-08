// Bundled question sets. SERVER-SIDE ONLY — never import from client/shared,
// or the answers ship to the webview.
import type { QA } from '../../../shared/letters';

import set01 from './set-01.json';
import set02 from './set-02.json';
import set03 from './set-03.json';
import set04 from './set-04.json';
import set05 from './set-05.json';
import set06 from './set-06.json';
import set07 from './set-07.json';
import set08 from './set-08.json';
import set09 from './set-09.json';
import set10 from './set-10.json';
import set11 from './set-11.json';
import set12 from './set-12.json';
import set13 from './set-13.json';
import set14 from './set-14.json';

export type SetDefinition = { id: string; questions: QA[] };

export const QUESTION_SETS: SetDefinition[] = [
  set01, set02, set03, set04, set05, set06, set07,
  set08, set09, set10, set11, set12, set13, set14,
] as SetDefinition[];

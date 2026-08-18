import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createScribbleHighlight } from './index';
import type { ScribbleVariant } from './index';

function pick(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`scribble demo: no element matches ${selector}`);
  return element;
}

/**
 * Traced by hand off `public/media/shot-a.jpg` (1.896:1), in the still's own box
 * space, so the outline holds at any rendered size.
 */
const DOG_OUTLINE: readonly (readonly [number, number])[] = [
  [0.532, 0.067],
  [0.612, 0.115],
  [0.686, 0.291],
  [0.692, 0.484],
  [0.721, 0.654],
  [0.762, 0.847],
  [0.752, 0.993],
  [0.504, 0.999],
  [0.446, 0.799],
  [0.411, 0.605],
  [0.395, 0.46],
  [0.373, 0.321],
  [0.408, 0.26],
  [0.446, 0.145],
];

const WALL: readonly { variant: ScribbleVariant; text: string; color: string }[] = [
  { variant: 'circle', text: 'the good part', color: 'var(--amber)' },
  { variant: 'underline', text: 'read this twice', color: 'var(--ember)' },
  { variant: 'box', text: 'ship it Friday', color: 'var(--amber)' },
  { variant: 'strike', text: 'not this one', color: '#e2564a' },
  { variant: 'arrow', text: 'start here', color: 'var(--ember)' },
  { variant: 'star', text: 'the whole idea', color: 'var(--amber)' },
  { variant: 'trace', text: 'any outline', color: 'var(--ember)' },
];

/** A rough diamond in box space, so the wall's `trace` cell has an outline to follow. */
const DIAMOND: readonly (readonly [number, number])[] = [
  [0.5, -0.35],
  [1.12, 0.5],
  [0.5, 1.35],
  [-0.12, 0.5],
];

createScribbleHighlight(pick('[data-scribble="hero"]'), {
  variant: 'circle',
  color: 'var(--amber)',
  strokeWidth: 4,
  jitter: 5,
  padding: 12,
  seed: 4,
  flutterOut: false,
});

const wall = pick('[data-scribble="wall"]');
WALL.forEach((entry, index) => {
  const cell = document.createElement('div');
  cell.className = 'scribble-demo-cell';

  const heading = document.createElement('h3');
  heading.textContent = entry.variant;

  const line = document.createElement('p');
  const target = document.createElement('span');
  target.className = 'scribble-demo-target';
  target.textContent = entry.text;
  line.append(target);
  cell.append(heading, line);
  wall.append(cell);

  createScribbleHighlight(target, {
    variant: entry.variant,
    color: entry.color,
    strokeWidth: entry.variant === 'star' ? 2.5 : 3.5,
    jitter: 4.5,
    padding: entry.variant === 'underline' ? 6 : 11,
    seed: 3 + index * 5,
    duration: 620,
    flutterOut: false,
    path: entry.variant === 'trace' ? DIAMOND : undefined,
  });
});

createScribbleHighlight(pick('[data-scribble="scroll"]'), {
  variant: 'underline',
  color: 'var(--ember)',
  strokeWidth: 4,
  jitter: 5,
  passes: 3,
  padding: 8,
  seed: 21,
  trigger: 'scroll',
  scroll: { start: 0.95, end: 0.45 },
});

createScribbleHighlight(pick('[data-scribble="trace"]'), {
  variant: 'trace',
  color: 'var(--amber)',
  strokeWidth: 6,
  frames: 8,
  fps: 14,
  jitter: 12,
  padding: 0,
  seed: 12,
  trigger: 'scroll',
  scroll: { start: 0.85, end: 0.5 },
  flutterOut: false,
  path: DOG_OUTLINE,
});

const handle = createScribbleHighlight(pick('[data-scribble="live"]'), {
  variant: 'circle',
  color: 'var(--amber)',
  strokeWidth: 3.5,
  frames: 6,
  fps: 12,
  jitter: 5,
  passes: 2,
  padding: 12,
  seed: 1,
  texture: 'crayon',
  trigger: 'inview',
  duration: 700,
  flutterOut: true,
});

createControls(pick('.demo-controls'), 'Scribble', [
  {
    kind: 'select',
    label: 'variant',
    value: 'circle',
    options: WALL.map((entry) => ({ label: entry.variant, value: entry.variant })),
    onInput: (value) => {
      handle.setOptions({
        variant: value as ScribbleVariant,
        path: value === 'trace' ? DIAMOND : undefined,
      });
      handle.replay();
    },
  },
  {
    kind: 'range',
    label: 'strokeWidth',
    min: 1,
    max: 10,
    step: 0.5,
    value: 3.5,
    onInput: (value) => handle.setOptions({ strokeWidth: value }),
  },
  {
    kind: 'range',
    label: 'frames',
    min: 1,
    max: 12,
    step: 1,
    value: 6,
    onInput: (value) => handle.setOptions({ frames: value }),
  },
  {
    kind: 'range',
    label: 'fps',
    min: 2,
    max: 30,
    step: 1,
    value: 12,
    onInput: (value) => handle.setOptions({ fps: value }),
  },
  {
    kind: 'range',
    label: 'jitter',
    min: 0,
    max: 14,
    step: 0.5,
    value: 5,
    format: (value) => `${value}px`,
    onInput: (value) => handle.setOptions({ jitter: value }),
  },
  {
    kind: 'range',
    label: 'passes',
    min: 1,
    max: 4,
    step: 1,
    value: 2,
    onInput: (value) => handle.setOptions({ passes: value }),
  },
  {
    kind: 'range',
    label: 'padding',
    min: 0,
    max: 32,
    step: 1,
    value: 12,
    format: (value) => `${value}px`,
    onInput: (value) => handle.setOptions({ padding: value }),
  },
  {
    kind: 'range',
    label: 'seed',
    min: 1,
    max: 40,
    step: 1,
    value: 1,
    onInput: (value) => handle.setOptions({ seed: value }),
  },
  {
    kind: 'range',
    label: 'duration',
    min: 200,
    max: 2000,
    step: 50,
    value: 700,
    format: (value) => `${value}ms`,
    onInput: (value) => handle.setOptions({ duration: value }),
  },
  {
    kind: 'select',
    label: 'texture',
    value: 'crayon',
    options: [
      { label: 'crayon', value: 'crayon' },
      { label: 'clean', value: 'clean' },
    ],
    onInput: (value) => handle.setOptions({ texture: value === 'clean' ? 'clean' : 'crayon' }),
  },
  {
    kind: 'toggle',
    label: 'flutterOut',
    value: true,
    onInput: (value) => handle.setOptions({ flutterOut: value }),
  },
  { kind: 'button', label: 'Replay', onInput: () => handle.replay() },
]);

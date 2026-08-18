import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createComicImpact } from './index';
import type { ComicImpactOptions, ImpactShape } from './index';

function pick(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`comic impact demo: no element matches ${selector}`);
  return element;
}

createComicImpact(pick('[data-comic-impact="hero"]'), {
  shape: 'jagged',
  fill: '#ef476f',
  points: 14,
  speedLines: 9,
  offset: 5,
  rotation: 4,
  seed: 11,
});

const live = createComicImpact(pick('[data-comic-impact="live"]'), {
  shape: 'starburst',
  fill: '#ffd23f',
  points: 12,
  speedLines: 14,
  trigger: 'inview',
  duration: 900,
  seed: 1,
});

const scrollImpacts: readonly {
  selector: string;
  options: ComicImpactOptions;
}[] = [
  {
    selector: '[data-comic-impact="bam"]',
    options: { shape: 'starburst', fill: '#ffd23f', rotation: -8, seed: 3 },
  },
  {
    selector: '[data-comic-impact="wham"]',
    options: { shape: 'cloud', fill: '#7bdff2', rotation: 5, points: 15, seed: 9 },
  },
  {
    selector: '[data-comic-impact="crash"]',
    options: { shape: 'jagged', fill: '#ef476f', rotation: -4, points: 10, seed: 15 },
  },
  {
    selector: '[data-comic-impact="zap"]',
    options: { shape: 'spike', fill: '#c7f464', rotation: 7, points: 16, seed: 22 },
  },
];

for (const entry of scrollImpacts) {
  createComicImpact(pick(entry.selector), {
    ...entry.options,
    trigger: 'scroll',
    scroll: { start: 0.9, end: 0.18 },
  });
}

createControls(pick('.demo-controls'), 'Comic Impact', [
  {
    kind: 'select',
    label: 'shape',
    value: 'starburst',
    options: [
      { label: 'starburst', value: 'starburst' },
      { label: 'cloud', value: 'cloud' },
      { label: 'jagged', value: 'jagged' },
      { label: 'spike', value: 'spike' },
    ],
    onInput: (value) => {
      live.setOptions({ shape: value as ImpactShape });
    },
  },
  {
    kind: 'range',
    label: 'points',
    min: 3,
    max: 24,
    step: 1,
    value: 12,
    onInput: (value) => live.setOptions({ points: value }),
  },
  {
    kind: 'range',
    label: 'irregularity',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.35,
    onInput: (value) => live.setOptions({ irregularity: value }),
  },
  {
    kind: 'range',
    label: 'speedLines',
    min: 0,
    max: 24,
    step: 1,
    value: 14,
    onInput: (value) => live.setOptions({ speedLines: value }),
  },
  {
    kind: 'range',
    label: 'offset',
    min: 0,
    max: 14,
    step: 1,
    value: 6,
    format: (value) => `${value}px`,
    onInput: (value) => live.setOptions({ offset: value }),
  },
  {
    kind: 'range',
    label: 'pop',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.45,
    onInput: (value) => live.setOptions({ pop: value }),
  },
  {
    kind: 'range',
    label: 'shake',
    min: 0,
    max: 10,
    step: 0.5,
    value: 3,
    format: (value) => `${value}px`,
    onInput: (value) => live.setOptions({ shake: value }),
  },
  {
    kind: 'range',
    label: 'rotation',
    min: -30,
    max: 30,
    step: 1,
    value: -8,
    format: (value) => `${value}°`,
    onInput: (value) => live.setOptions({ rotation: value }),
  },
  { kind: 'button', label: 'Replay', onInput: () => live.replay() },
]);

import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createComicPrint } from './index';
import type { ComicPalette, ComicPrintHandle, ComicPrintOptions } from './index';

function pick(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`comic print demo: no element matches ${selector}`);
  return element;
}

const handles: ComicPrintHandle[] = [
  createComicPrint(pick('[data-comic-print="text"]')),
  createComicPrint(pick('[data-comic-print="image"]'), { palette: 'sunday', levels: 6 }),
  createComicPrint(pick('[data-comic-print="video"]'), {
    palette: 'newsprint',
    dotSize: 5,
    halftone: 0.48,
  }),
];

function updateAll(patch: Partial<ComicPrintOptions>): void {
  for (const handle of handles) handle.setOptions(patch);
}

createControls(pick('.demo-controls'), 'Comic Print', [
  {
    kind: 'select',
    label: 'palette',
    value: 'newsprint',
    options: [
      { label: 'newsprint', value: 'newsprint' },
      { label: 'sunday', value: 'sunday' },
      { label: 'mono', value: 'mono' },
      { label: 'noir', value: 'noir' },
    ],
    onInput: (value) => updateAll({ palette: value as ComicPalette }),
  },
  {
    kind: 'range',
    label: 'dotSize',
    min: 2,
    max: 10,
    step: 0.5,
    value: 4,
    format: (value) => `${value}px`,
    onInput: (value) => updateAll({ dotSize: value }),
  },
  {
    kind: 'range',
    label: 'halftone',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.55,
    onInput: (value) => updateAll({ halftone: value }),
  },
  {
    kind: 'range',
    label: 'screenAngle',
    min: -30,
    max: 45,
    step: 1,
    value: 15,
    format: (value) => `${value}°`,
    onInput: (value) => updateAll({ screenAngle: value }),
  },
  {
    kind: 'range',
    label: 'levels',
    min: 2,
    max: 10,
    step: 1,
    value: 5,
    onInput: (value) => updateAll({ levels: value }),
  },
  {
    kind: 'range',
    label: 'misregistration',
    min: 0,
    max: 6,
    step: 0.25,
    value: 1.5,
    format: (value) => `${value}px`,
    onInput: (value) => updateAll({ misregistration: value }),
  },
  {
    kind: 'range',
    label: 'grain',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.4,
    onInput: (value) => updateAll({ grain: value }),
  },
  {
    kind: 'range',
    label: 'roughness',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.3,
    onInput: (value) => updateAll({ roughness: value }),
  },
  {
    kind: 'range',
    label: 'contrast',
    min: 0,
    max: 2,
    step: 0.05,
    value: 1.15,
    onInput: (value) => updateAll({ contrast: value }),
  },
]);

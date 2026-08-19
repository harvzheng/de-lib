/**
 * Demo chrome for Ripped Page. Never imported by the effect itself.
 */

import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createRippedPage } from './index';
import type { Control } from '../../demo/controls';
import type { TearAxis, TearPivot } from './tear';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing mount point: ${selector}`);
  }
  return element;
}

const stage = requireElement<HTMLElement>('#rip');
const controlsHost = requireElement<HTMLElement>('.demo-controls');

const rip = createRippedPage(stage, {
  from: '/media/shot-a.jpg',
  to: '/media/shot-c.jpg',
});

let seed = 1;

const controls: Control[] = [
  {
    kind: 'select',
    label: 'Axis',
    options: [
      { label: 'horizontal', value: 'horizontal' },
      { label: 'vertical', value: 'vertical' },
    ],
    value: 'horizontal',
    onInput: (value) => rip.setOptions({ axis: value as TearAxis }),
  },
  {
    kind: 'select',
    label: 'Hinge',
    options: [
      { label: 'start', value: 'start' },
      { label: 'end', value: 'end' },
      { label: 'centre', value: 'center' },
    ],
    value: 'start',
    onInput: (value) => rip.setOptions({ pivot: value as TearPivot }),
  },
  {
    kind: 'range',
    label: 'Tilt',
    min: -35,
    max: 35,
    step: 1,
    value: -7,
    format: (value) => `${value}°`,
    onInput: (value) => rip.setOptions({ angle: value }),
  },
  {
    kind: 'range',
    label: 'Crosses at',
    min: 0.1,
    max: 0.9,
    step: 0.01,
    value: 0.52,
    format: (value) => value.toFixed(2),
    onInput: (value) => rip.setOptions({ offset: value }),
  },
  {
    kind: 'range',
    label: 'Roughness',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.55,
    format: (value) => value.toFixed(2),
    onInput: (value) => rip.setOptions({ roughness: value }),
  },
  {
    kind: 'range',
    label: 'Fibre tufts',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.5,
    format: (value) => value.toFixed(2),
    onInput: (value) => rip.setOptions({ fiber: value }),
  },
  {
    kind: 'range',
    label: 'Paper edge',
    min: 0,
    max: 10,
    step: 0.5,
    value: 3,
    format: (value) => `${value}px`,
    onInput: (value) => rip.setOptions({ edge: value }),
  },
  {
    kind: 'range',
    label: 'Separation',
    min: 0,
    max: 2,
    step: 0.05,
    value: 0.95,
    format: (value) => `${value.toFixed(2)} frames`,
    onInput: (value) => rip.setOptions({ separation: value }),
  },
  {
    kind: 'range',
    label: 'Counter-rotation',
    min: 0,
    max: 30,
    step: 0.5,
    value: 9,
    format: (value) => `${value}°`,
    onInput: (value) => rip.setOptions({ rotation: value }),
  },
  {
    kind: 'range',
    label: 'Hold before it goes',
    min: 0,
    max: 0.6,
    step: 0.01,
    value: 0.12,
    format: (value) => value.toFixed(2),
    onInput: (value) => rip.setOptions({ hold: value }),
  },
  {
    kind: 'range',
    label: 'Settle punch',
    min: 0,
    max: 0.4,
    step: 0.01,
    value: 0.12,
    format: (value) => value.toFixed(2),
    onInput: (value) => rip.setOptions({ zoom: value }),
  },
  {
    kind: 'range',
    label: 'Shadow',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.55,
    format: (value) => value.toFixed(2),
    onInput: (value) => rip.setOptions({ shadow: value }),
  },
  {
    kind: 'range',
    label: 'Grain',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.3,
    format: (value) => value.toFixed(2),
    onInput: (value) => rip.setOptions({ grain: value }),
  },
  {
    kind: 'button',
    label: 'Tear again',
    onInput: () => {
      seed += 1;
      rip.setOptions({ seed });
    },
  },
];

createControls(controlsHost, 'Ripped Page', controls);

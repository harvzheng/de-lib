/**
 * Demo chrome for Film Burn Overlay. Never imported by the effect itself.
 */

import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createFilmBurnOverlay } from './index';
import type { Control } from '../../demo/controls';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing mount point: ${selector}`);
  }
  return element;
}

const shot = requireElement<HTMLElement>('#shot');
const controlsHost = requireElement<HTMLElement>('.demo-controls');

const effect = createFilmBurnOverlay(shot);

let reshuffleSeed = 1;

const controls: Control[] = [
  {
    kind: 'range',
    label: 'Intensity',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.7,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ intensity: value }),
  },
  {
    kind: 'range',
    label: 'Light leak',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.6,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ leak: value }),
  },
  {
    kind: 'range',
    label: 'Holes',
    min: 0,
    max: 8,
    step: 1,
    value: 4,
    format: (value) => String(value),
    onInput: (value) => effect.setOptions({ holes: value }),
  },
  {
    kind: 'range',
    label: 'Ember brightness',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.7,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ ember: value }),
  },
  {
    kind: 'range',
    label: 'Parallax (px)',
    min: 0,
    max: 160,
    step: 5,
    value: 60,
    format: (value) => `${value}px`,
    onInput: (value) => effect.setOptions({ parallax: value }),
  },
  {
    kind: 'range',
    label: 'Zoom',
    min: 0,
    max: 0.3,
    step: 0.01,
    value: 0.08,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ zoom: value }),
  },
  {
    kind: 'range',
    label: 'Grain',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.4,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ grain: value }),
  },
  {
    kind: 'toggle',
    label: 'Ember flicker',
    value: true,
    onInput: (value) => effect.setOptions({ flicker: value }),
  },
  {
    kind: 'button',
    label: 'Reshuffle holes',
    onInput: () => {
      reshuffleSeed += 1;
      effect.setOptions({ seed: reshuffleSeed });
    },
  },
];

createControls(controlsHost, 'Film Burn Overlay', controls);

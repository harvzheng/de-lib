import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createSubwayMotion } from './index';
import type { Control } from '../../demo/controls';
import type { SubwayMotionOptions, SubwayPerspective } from './index';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing mount point: ${selector}`);
  }
  return element;
}

const storyHost = requireElement<HTMLElement>('#story-host');
const mediaHost = requireElement<HTMLElement>('#media-host');
const controlsHost = requireElement<HTMLElement>('.demo-controls');
const effects = [
  createSubwayMotion(storyHost, { rain: 0.18 }),
  createSubwayMotion(mediaHost, { rain: 0.18, seed: 7 }),
];

function updateEffects(patch: Partial<SubwayMotionOptions>): void {
  for (const effect of effects) {
    effect.setOptions(patch);
  }
}

let seed = 7;

const controls: Control[] = [
  {
    kind: 'select',
    label: 'Perspective',
    options: [
      { label: 'Inside the window', value: 'window' },
      { label: 'From the platform', value: 'platform' },
    ],
    value: 'window',
    onInput: (value) => {
      const perspective: SubwayPerspective = value === 'platform' ? 'platform' : 'window';
      updateEffects({ perspective });
    },
  },
  {
    kind: 'range',
    label: 'Speed',
    min: 0,
    max: 2.5,
    step: 0.05,
    value: 1,
    format: (value) => `${value.toFixed(2)}×`,
    onInput: (value) => updateEffects({ speed: value }),
  },
  {
    kind: 'range',
    label: 'Intensity',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.8,
    format: (value) => value.toFixed(2),
    onInput: (value) => updateEffects({ intensity: value }),
  },
  {
    kind: 'range',
    label: 'Darkness',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.55,
    format: (value) => value.toFixed(2),
    onInput: (value) => updateEffects({ darkness: value }),
  },
  {
    kind: 'range',
    label: 'Passing lights',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.5,
    format: (value) => value.toFixed(2),
    onInput: (value) => updateEffects({ lights: value }),
  },
  {
    kind: 'range',
    label: 'Reflection',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.4,
    format: (value) => value.toFixed(2),
    onInput: (value) => updateEffects({ reflection: value }),
  },
  {
    kind: 'range',
    label: 'Rain distortion',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.18,
    format: (value) => value.toFixed(2),
    onInput: (value) => updateEffects({ rain: value }),
  },
  {
    kind: 'range',
    label: 'Station light',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.35,
    format: (value) => value.toFixed(2),
    onInput: (value) => updateEffects({ flashes: value }),
  },
  {
    kind: 'range',
    label: 'Rumble',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.3,
    format: (value) => value.toFixed(2),
    onInput: (value) => updateEffects({ rumble: value }),
  },
  {
    kind: 'button',
    label: 'Reshuffle light rhythm',
    onInput: () => {
      seed += 1;
      updateEffects({ seed });
    },
  },
];

createControls(controlsHost, 'Subway Motion', controls);

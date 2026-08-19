/**
 * Demo chrome for Street Light. Never imported by the effect itself.
 */

import '../../demo/demo.css';
import './effect.css';

import { onTick } from '../../core/raf';
import { createControls } from '../../demo/controls';
import { createStreetLight } from './index';
import type { Control } from '../../demo/controls';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing mount point: ${selector}`);
  }
  return element;
}

const scene = requireElement<HTMLElement>('#scene');
const readout = requireElement<HTMLElement>('#progress');
const coin = requireElement<HTMLElement>('#coin');
const controlsHost = requireElement<HTMLElement>('.demo-controls');

const lamp = createStreetLight(scene);

/** The rack's own progress value, so flipping back to manual resumes where it was. */
let manualProgress = 0.5;

// The coin is host content, so the lamp lights it like it lights everything
// else; spinning it from the effect's own progress is what makes it read as
// being flipped while it crosses the pool.
let shown = -1;
onTick(() => {
  const progress = lamp.progress;
  if (progress === shown) return;
  shown = progress;
  readout.textContent = progress.toFixed(3);
  coin.style.transform = `rotateX(${(progress * 2160).toFixed(1)}deg)`;
});

const controls: Control[] = [
  {
    kind: 'toggle',
    label: 'Scroll-driven',
    value: true,
    onInput: (value) =>
      lamp.setOptions(
        value ? { scroll: { start: 1, end: 0 } } : { scroll: false, progress: manualProgress },
      ),
  },
  {
    kind: 'range',
    label: 'Progress',
    min: 0,
    max: 1,
    step: 0.002,
    value: 0.5,
    format: (value) => value.toFixed(3),
    onInput: (value) => {
      manualProgress = value;
      lamp.setOptions({ progress: value });
    },
  },
  {
    kind: 'range',
    label: 'Illumination',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.9,
    format: (value) => value.toFixed(2),
    onInput: (value) => lamp.setOptions({ glow: value }),
  },
  {
    kind: 'range',
    label: 'Darkness',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.82,
    format: (value) => value.toFixed(2),
    onInput: (value) => lamp.setOptions({ depth: value }),
  },
  {
    kind: 'select',
    label: 'Lamp',
    value: '#ffc27a',
    options: [
      { label: 'Sodium', value: '#ffc27a' },
      { label: 'Old sodium', value: '#ff8f3a' },
      { label: 'Mercury', value: '#d8e8f0' },
      { label: 'LED white', value: '#f2f6ff' },
    ],
    onInput: (value) => lamp.setOptions({ light: value }),
  },
  {
    kind: 'select',
    label: 'Night',
    value: '#4a5c80',
    options: [
      { label: 'City blue', value: '#4a5c80' },
      { label: 'Deep night', value: '#2b3654' },
      { label: 'Fog grey', value: '#6d7686' },
      { label: 'Pitch (wrong on purpose)', value: '#14161c' },
    ],
    onInput: (value) => lamp.setOptions({ night: value }),
  },
  {
    kind: 'toggle',
    label: 'Show the fixture',
    value: true,
    onInput: (value) => lamp.setOptions({ fixture: value }),
  },
  {
    kind: 'range',
    label: 'Lamp line',
    min: 0.05,
    max: 0.7,
    step: 0.01,
    value: 0.24,
    format: (value) => `${(value * 100).toFixed(0)}% down`,
    onInput: (value) => lamp.setOptions({ anchor: value }),
  },
  {
    kind: 'range',
    label: 'Lamp position',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.4,
    format: (value) => value.toFixed(2),
    onInput: (value) => lamp.setOptions({ column: value }),
  },
  {
    kind: 'range',
    label: 'Throw',
    min: 0.05,
    max: 0.7,
    step: 0.01,
    value: 0.3,
    format: (value) => value.toFixed(2),
    onInput: (value) => lamp.setOptions({ drop: value }),
  },
  {
    kind: 'range',
    label: 'Pool width',
    min: 0.05,
    max: 0.6,
    step: 0.01,
    value: 0.19,
    format: (value) => value.toFixed(2),
    onInput: (value) => lamp.setOptions({ spread: value }),
  },
  {
    kind: 'range',
    label: 'Pool length',
    min: 1,
    max: 3.5,
    step: 0.05,
    value: 1.45,
    format: (value) => `${value.toFixed(2)}×`,
    onInput: (value) => lamp.setOptions({ stretch: value }),
  },
  {
    kind: 'range',
    label: 'Mist',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0,
    format: (value) => (value === 0 ? 'off' : value.toFixed(2)),
    onInput: (value) => lamp.setOptions({ cone: value }),
  },
  {
    kind: 'range',
    label: 'Sway',
    min: 0,
    max: 40,
    step: 1,
    value: 0,
    format: (value) => (value === 0 ? 'still' : `${value.toFixed(0)}px`),
    onInput: (value) => lamp.setOptions({ sway: value }),
  },
  {
    kind: 'range',
    label: 'Buzz',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0,
    format: (value) => (value === 0 ? 'steady' : value.toFixed(2)),
    onInput: (value) => lamp.setOptions({ buzz: value }),
  },
];

createControls(controlsHost, 'Street Light', controls);

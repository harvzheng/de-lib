/**
 * Demo chrome for Wiggly Text. Never imported by the effect itself.
 */

import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createWigglyText } from './index';
import type { Control } from '../../demo/controls';
import type { WigglyTextOptions } from './index';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing mount point: ${selector}`);
  }
  return element;
}

const controlsHost = requireElement<HTMLElement>('.demo-controls');
const frameReadout = requireElement<HTMLElement>('#wiggle-frame');
const pressButton = requireElement<HTMLButtonElement>('#wiggle-button');
const pressReadout = requireElement<HTMLElement>('#wiggle-button-count');

/**
 * One instance per specimen, all driven together: the point of the page is that
 * the same settings produce the same wiggle on wildly different type.
 */
const specimens = [...document.querySelectorAll<HTMLElement>('[data-wiggle]')].map((host) =>
  createWigglyText(host),
);

function apply(patch: WigglyTextOptions): void {
  for (const specimen of specimens) specimen.setOptions(patch);
}

/** Proof the filter does not eat pointer events: the button underneath still works. */
let presses = 0;
pressButton.addEventListener('click', () => {
  presses += 1;
  pressReadout.textContent = `${presses} ${presses === 1 ? 'press' : 'presses'}`;
});

let shown = -1;
function showFrame(): void {
  const frame = specimens[0].frame;
  if (frame !== shown) {
    shown = frame;
    frameReadout.textContent = String(frame);
  }
  requestAnimationFrame(showFrame);
}
showFrame();

let seed = 1;

const controls: Control[] = [
  {
    kind: 'range',
    label: 'Amplitude',
    min: 0,
    max: 8,
    step: 0.1,
    value: 2,
    format: (value) => `${value.toFixed(1)}px`,
    onInput: (value) => apply({ amplitude: value }),
  },
  {
    kind: 'range',
    label: 'Wavelength',
    min: 8,
    max: 200,
    step: 2,
    value: 90,
    format: (value) => `${value.toFixed(0)}px`,
    onInput: (value) => apply({ wavelength: value }),
  },
  {
    kind: 'range',
    label: 'Roughness',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.35,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ roughness: value }),
  },
  {
    kind: 'range',
    label: 'Boil',
    min: 0,
    max: 24,
    step: 1,
    value: 8,
    format: (value) => (value === 0 ? 'held' : `${value.toFixed(0)}/sec`),
    onInput: (value) => apply({ boil: value }),
  },
  {
    kind: 'range',
    label: 'Frames in cycle',
    min: 1,
    max: 12,
    step: 1,
    value: 3,
    format: (value) => value.toFixed(0),
    onInput: (value) => apply({ frames: value }),
  },
  {
    kind: 'range',
    label: 'Edge crispness',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.7,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ crisp: value }),
  },
  {
    kind: 'button',
    label: 'Redraw',
    onInput: () => {
      seed += 1;
      apply({ seed });
    },
  },
];

createControls(controlsHost, 'Wiggly Text', controls);

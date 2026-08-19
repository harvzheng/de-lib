/**
 * Demo chrome for Neon Sign. Never imported by the effect itself.
 */

import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createNeonSign } from './index';
import type { Control } from '../../demo/controls';
import type { NeonSignOptions } from './index';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing mount point: ${selector}`);
  }
  return element;
}

const controlsHost = requireElement<HTMLElement>('.demo-controls');
const selectionReadout = requireElement<HTMLElement>('#neon-selection');
const brightnessReadout = requireElement<HTMLElement>('#neon-brightness');

/**
 * One instance per sign, all driven together: the page's claim is that the same
 * options light wildly different type, so the controls have to prove it.
 */
const signs = [...document.querySelectorAll<HTMLElement>('[data-neon]')].map((host) =>
  createNeonSign(host),
);

function apply(patch: NeonSignOptions): void {
  for (const sign of signs) sign.setOptions(patch);
}

/**
 * Proof the tube is still text: this reports what the browser hands over, so a
 * per-character wrapper or a duplicated text node would show up here as scrambled
 * or doubled characters rather than as the line you dragged over.
 */
document.addEventListener('selectionchange', () => {
  const selected = document.getSelection()?.toString() ?? '';
  selectionReadout.textContent =
    selected.length === 0
      ? 'Nothing selected yet.'
      : `${selected.length} characters selected: ${JSON.stringify(selected)}`;
});

let shown = '';
function showBrightness(): void {
  const reading = `Tube output: ${(signs[0].brightness * 100).toFixed(0)}%`;
  if (reading !== shown) {
    shown = reading;
    brightnessReadout.textContent = reading;
  }
  requestAnimationFrame(showBrightness);
}
showBrightness();

let seed = 1;

const controls: Control[] = [
  {
    kind: 'select',
    label: 'Gas',
    value: '#ff2e63',
    options: [
      { label: 'Pink', value: '#ff2e63' },
      { label: 'Neon red', value: '#ff3b14' },
      { label: 'Argon blue', value: '#3aa0ff' },
      { label: 'Mercury white', value: '#7ef9ff' },
      { label: 'Krypton green', value: '#39ff88' },
      { label: 'Gold', value: '#ffb03a' },
    ],
    onInput: (value) => apply({ color: value }),
  },
  {
    kind: 'range',
    label: 'Core heat',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.78,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ coreHeat: value }),
  },
  {
    kind: 'range',
    label: 'Glow radius',
    min: 0,
    max: 60,
    step: 1,
    value: 18,
    format: (value) => `${value.toFixed(0)}px`,
    onInput: (value) => apply({ glowRadius: value }),
  },
  {
    kind: 'range',
    label: 'Glow intensity',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.85,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ intensity: value }),
  },
  {
    kind: 'range',
    label: 'Spill',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.55,
    format: (value) => (value === 0 ? 'off' : value.toFixed(2)),
    onInput: (value) => apply({ spill: value }),
  },
  {
    kind: 'range',
    label: 'Spill reach',
    min: 0,
    max: 400,
    step: 10,
    value: 140,
    format: (value) => `${value.toFixed(0)}px`,
    onInput: (value) => apply({ spillRadius: value }),
  },
  {
    kind: 'range',
    label: 'Flicker',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.3,
    format: (value) => (value === 0 ? 'steady' : value.toFixed(2)),
    onInput: (value) => apply({ flicker: value }),
  },
  {
    kind: 'toggle',
    label: 'Lit',
    value: true,
    onInput: (value) => apply({ lit: value }),
  },
  {
    kind: 'button',
    label: 'New tube',
    onInput: () => {
      seed += 1;
      apply({ seed });
    },
  },
];

createControls(controlsHost, 'Neon Sign', controls);

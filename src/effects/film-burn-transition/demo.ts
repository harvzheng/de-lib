import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createFilmBurnTransition } from './index';
import type { BurnOrigin, BurnRenderer } from './index';

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`film-burn-transition demo: no ${selector} in the page.`);
  return element;
}

const host = requireElement('#burn');
const controls = requireElement('#controls');
const readout = requireElement('#active');

const burn = createFilmBurnTransition(host, {
  from: '/media/shot-a.jpg',
  to: '/media/shot-c.jpg',
});

let swapped = false;

function showRenderer(requested: BurnRenderer): void {
  const active = burn.activeRenderer;
  if (requested === active) readout.textContent = active;
  else if (requested === 'auto') readout.textContent = `auto → ${active}`;
  else readout.textContent = `${requested} → ${active} (unavailable)`;
}

showRenderer('auto');

createControls(controls, 'Film burn', [
  {
    kind: 'select',
    label: 'Renderer',
    options: [
      { label: 'auto', value: 'auto' },
      { label: 'webgl', value: 'webgl' },
      { label: 'css', value: 'css' },
    ],
    value: 'auto',
    onInput: (value) => {
      const requested = value as BurnRenderer;
      burn.setOptions({ renderer: requested });
      showRenderer(requested);
    },
  },
  {
    kind: 'select',
    label: 'Origin',
    options: [
      { label: 'center', value: 'center' },
      { label: 'left', value: 'left' },
      { label: 'right', value: 'right' },
      { label: 'top', value: 'top' },
      { label: 'bottom', value: 'bottom' },
      { label: 'none', value: 'none' },
    ],
    value: 'center',
    onInput: (value) => burn.setOptions({ origin: value as BurnOrigin }),
  },
  {
    kind: 'range',
    label: 'Edge',
    min: 0.01,
    max: 0.2,
    step: 0.005,
    value: 0.06,
    format: (value) => value.toFixed(3),
    onInput: (value) => burn.setOptions({ edge: value }),
  },
  {
    kind: 'range',
    label: 'Scale',
    min: 1,
    max: 12,
    step: 0.5,
    value: 3,
    format: (value) => value.toFixed(1),
    onInput: (value) => burn.setOptions({ scale: value }),
  },
  {
    kind: 'range',
    label: 'Grain',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.35,
    format: (value) => value.toFixed(2),
    onInput: (value) => burn.setOptions({ grain: value }),
  },
  {
    kind: 'range',
    label: 'Seed',
    min: 1,
    max: 40,
    step: 1,
    value: 1,
    onInput: (value) => burn.setOptions({ seed: value }),
  },
  {
    kind: 'button',
    label: 'Swap the shots',
    onInput: () => {
      swapped = !swapped;
      burn.setOptions({
        from: swapped ? '/media/shot-c.jpg' : '/media/shot-a.jpg',
        to: swapped ? '/media/shot-a.jpg' : '/media/shot-c.jpg',
      });
    },
  },
]);

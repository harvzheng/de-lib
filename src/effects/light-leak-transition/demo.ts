import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createLightLeakTransition } from './index';
import type { LeakDirection, LeakRenderer, LeakStyle } from './index';

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`light-leak-transition demo: no ${selector} in the page.`);
  }
  return element;
}

const host = requireElement('#light-leak');
const controls = requireElement('#controls');
const styleReadout = requireElement('#active-style');
const rendererReadout = requireElement('#active-renderer');

const leak = createLightLeakTransition(host, {
  from: '/media/shot-a.jpg',
  to: '/media/shot-c.jpg',
});

function showRenderer(requested: LeakRenderer): void {
  const active = leak.activeRenderer;
  if (requested === active) rendererReadout.textContent = active;
  else if (requested === 'auto') rendererReadout.textContent = `auto → ${active}`;
  else rendererReadout.textContent = `${requested} → ${active} (unavailable)`;
}

showRenderer('auto');

createControls(controls, 'Light leak', [
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
      const requested = value as LeakRenderer;
      leak.setOptions({ renderer: requested });
      showRenderer(requested);
    },
  },
  {
    kind: 'select',
    label: 'Style',
    options: [
      { label: 'flash', value: 'flash' },
      { label: 'sweep', value: 'sweep' },
    ],
    value: 'flash',
    onInput: (value) => {
      const style = value as LeakStyle;
      leak.setOptions({ style });
      styleReadout.textContent = style;
    },
  },
  {
    kind: 'select',
    label: 'Direction',
    options: [
      { label: 'left', value: 'left' },
      { label: 'right', value: 'right' },
      { label: 'top', value: 'top' },
      { label: 'bottom', value: 'bottom' },
      { label: 'random', value: 'random' },
    ],
    value: 'left',
    onInput: (value) => leak.setOptions({ direction: value as LeakDirection }),
  },
  {
    kind: 'range',
    label: 'Intensity',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.85,
    format: (value) => value.toFixed(2),
    onInput: (value) => leak.setOptions({ intensity: value }),
  },
  {
    kind: 'range',
    label: 'Bloom',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.7,
    format: (value) => value.toFixed(2),
    onInput: (value) => leak.setOptions({ bloom: value }),
  },
  {
    kind: 'range',
    label: 'Warmth',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.5,
    format: (value) => value.toFixed(2),
    onInput: (value) => leak.setOptions({ warmth: value }),
  },
  {
    kind: 'range',
    label: 'Softness',
    min: 0,
    max: 180,
    step: 5,
    value: 80,
    format: (value) => `${Math.round(value)} px`,
    onInput: (value) => leak.setOptions({ softness: value }),
  },
  {
    kind: 'range',
    label: 'Organic',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.4,
    format: (value) => value.toFixed(2),
    onInput: (value) => leak.setOptions({ organic: value }),
  },
  {
    kind: 'range',
    label: 'Halation',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.45,
    format: (value) => value.toFixed(2),
    onInput: (value) => leak.setOptions({ halation: value }),
  },
  {
    kind: 'range',
    label: 'Grain',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.3,
    format: (value) => value.toFixed(2),
    onInput: (value) => leak.setOptions({ grain: value }),
  },
  {
    kind: 'range',
    label: 'Seed',
    min: 1,
    max: 40,
    step: 1,
    value: 1,
    onInput: (value) => leak.setOptions({ seed: value }),
  },
]);

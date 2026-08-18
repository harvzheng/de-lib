import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createParticulateDissolve } from './index';
import type {
  DissolveDirection,
  DissolveRenderer,
  ParticulateDissolveOptions,
} from './index';

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`particulate-dissolve demo: no ${selector} in the page.`);
  return element;
}

const liveHost = requireElement('#live-dissolve');
const imageHost = requireElement('#image-dissolve');
const controls = requireElement('#controls');
const requestedReadout = requireElement('#requested');
const activeReadout = requireElement('#active');

const liveDissolve = createParticulateDissolve(liveHost, {
  renderer: 'css',
  direction: 'up',
  seed: 1,
});
const imageDissolve = createParticulateDissolve(imageHost, {
  src: '/media/shot-a.jpg',
  renderer: 'auto',
  direction: 'up',
  seed: 1,
});

function setSharedOptions(patch: Partial<ParticulateDissolveOptions>): void {
  liveDissolve.setOptions(patch);
  imageDissolve.setOptions(patch);
}

function showRenderer(requested: DissolveRenderer): void {
  const active = imageDissolve.activeRenderer;
  requestedReadout.textContent = requested;
  if (requested === active) activeReadout.textContent = active;
  else if (requested === 'auto') activeReadout.textContent = `auto → ${active}`;
  else activeReadout.textContent = `${requested} → ${active} (fallback)`;
}

showRenderer('auto');

createControls(controls, 'Particulate dissolve', [
  {
    kind: 'select',
    label: 'Media renderer',
    options: [
      { label: 'auto', value: 'auto' },
      { label: 'webgl', value: 'webgl' },
      { label: 'css', value: 'css' },
    ],
    value: 'auto',
    onInput: (value) => {
      const requested = value as DissolveRenderer;
      imageDissolve.setOptions({ renderer: requested });
      showRenderer(requested);
    },
  },
  {
    kind: 'select',
    label: 'Direction',
    options: [
      { label: 'up', value: 'up' },
      { label: 'right', value: 'right' },
      { label: 'down', value: 'down' },
      { label: 'left', value: 'left' },
      { label: 'random', value: 'random' },
    ],
    value: 'up',
    onInput: (value) => setSharedOptions({ direction: value as DissolveDirection }),
  },
  {
    kind: 'range',
    label: 'Drift',
    min: 0,
    max: 0.9,
    step: 0.05,
    value: 0.45,
    format: (value) => value.toFixed(2),
    onInput: (value) => setSharedOptions({ drift: value }),
  },
  {
    kind: 'range',
    label: 'Grain',
    min: 2,
    max: 18,
    step: 1,
    value: 6,
    onInput: (value) => setSharedOptions({ grain: value }),
  },
  {
    kind: 'range',
    label: 'Edge lead',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.6,
    format: (value) => value.toFixed(2),
    onInput: (value) => setSharedOptions({ edge: value }),
  },
  {
    kind: 'range',
    label: 'Turbulence',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.35,
    format: (value) => value.toFixed(2),
    onInput: (value) => setSharedOptions({ turbulence: value }),
  },
  {
    kind: 'range',
    label: 'Seed',
    min: 1,
    max: 40,
    step: 1,
    value: 1,
    onInput: (value) => setSharedOptions({ seed: value }),
  },
]);

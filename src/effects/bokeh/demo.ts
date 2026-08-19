/**
 * Demo chrome for Bokeh. Never imported by the effect itself.
 */

import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createBokeh } from './index';
import type { Control } from '../../demo/controls';
import type { BokehRenderer } from './index';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing mount point: ${selector}`);
  }
  return element;
}

const stage = requireElement<HTMLElement>('#bokeh');
const controlsHost = requireElement<HTMLElement>('.demo-controls');
const readout = requireElement<HTMLElement>('#active');
const anchorReadout = requireElement<HTMLElement>('#anchored');

const effect = createBokeh(stage);

function showRenderer(requested: BokehRenderer): void {
  const active = effect.activeRenderer;
  if (requested === active) readout.textContent = active;
  else if (requested === 'auto') readout.textContent = `auto → ${active}`;
  else readout.textContent = `${requested} → ${active} (unavailable)`;
}

function showAnchors(): void {
  anchorReadout.textContent = String(effect.anchoredCount);
}

showRenderer('auto');
showAnchors();

let seed = 1;

const controls: Control[] = [
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
      const renderer = value as BokehRenderer;
      effect.setOptions({ renderer });
      showRenderer(renderer);
    },
  },
  {
    kind: 'range',
    label: 'Follow highlights',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.9,
    format: (value) => (value === 0 ? 'free field' : value.toFixed(2)),
    onInput: (value) => {
      effect.setOptions({ follow: value });
      showAnchors();
    },
  },
  {
    kind: 'toggle',
    label: 'Tint from source',
    value: true,
    onInput: (value) => effect.setOptions({ tintFromSource: value }),
  },
  {
    kind: 'range',
    label: 'Count',
    min: 0,
    max: 64,
    step: 1,
    value: 20,
    onInput: (value) => {
      effect.setOptions({ count: value });
      showAnchors();
    },
  },
  {
    kind: 'range',
    label: 'Size',
    min: 0.04,
    max: 0.5,
    step: 0.01,
    value: 0.16,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ size: value }),
  },
  {
    kind: 'range',
    label: 'Variance',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.55,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ variance: value }),
  },
  {
    kind: 'range',
    label: 'Softness',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.7,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ softness: value }),
  },
  {
    kind: 'range',
    label: 'Rim',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.28,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ rim: value }),
  },
  {
    kind: 'select',
    label: 'Aperture blades',
    options: [
      { label: 'round', value: '0' },
      { label: '5', value: '5' },
      { label: '6', value: '6' },
      { label: '7', value: '7' },
      { label: '9', value: '9' },
    ],
    value: '0',
    onInput: (value) => effect.setOptions({ blades: Number(value) }),
  },
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
    label: 'Shimmer',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.7,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ shimmer: value }),
  },
  {
    kind: 'range',
    label: 'Shimmer rate',
    min: 0,
    max: 24,
    step: 0.5,
    value: 7,
    format: (value) => `${value.toFixed(1)} / scroll`,
    onInput: (value) => effect.setOptions({ shimmerRate: value }),
  },
  {
    kind: 'range',
    label: 'Parallax',
    min: 0,
    max: 2,
    step: 0.05,
    value: 0.6,
    format: (value) => `${value.toFixed(2)} host heights`,
    onInput: (value) => effect.setOptions({ parallax: value }),
  },
  {
    kind: 'range',
    label: 'Drift',
    min: 0,
    max: 0.4,
    step: 0.01,
    value: 0.05,
    format: (value) => `${value.toFixed(2)} Hz`,
    onInput: (value) => effect.setOptions({ drift: value }),
  },
  {
    kind: 'button',
    label: 'Reshuffle field',
    onInput: () => {
      seed += 1;
      effect.setOptions({ seed });
    },
  },
  {
    kind: 'button',
    label: 'Resample highlights',
    onInput: () => {
      effect.resample();
      showAnchors();
    },
  },
];

createControls(controlsHost, 'Bokeh', controls);

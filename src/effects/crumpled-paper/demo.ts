/**
 * Demo chrome for Crumpled Paper. Never imported by the effect itself.
 */

import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createCrumpledPaper } from './index';
import type { Control } from '../../demo/controls';
import type { CrumpledPaperOptions, CrumpleRenderer } from './index';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing mount point: ${selector}`);
  }
  return element;
}

const sheetHost = requireElement<HTMLElement>('#sheet');
const shotHost = requireElement<HTMLElement>('#shot');
const controlsHost = requireElement<HTMLElement>('.demo-controls');
const angleReadout = requireElement<HTMLElement>('#angle');
const rendererReadout = requireElement<HTMLElement>('#active');

/** Both hosts run the same options, so the rack drives them together. */
const sheets = [createCrumpledPaper(sheetHost), createCrumpledPaper(shotHost)];

let light = 135;
let seed = 1;

function apply(patch: CrumpledPaperOptions): void {
  for (const sheet of sheets) sheet.setOptions(patch);
}

function showRenderer(requested: CrumpleRenderer): void {
  const active = sheets[0].activeRenderer;
  if (requested === active) rendererReadout.textContent = active;
  else if (requested === 'auto') rendererReadout.textContent = `auto \u2192 ${active}`;
  else rendererReadout.textContent = `${requested} \u2192 ${active} (unavailable)`;
}

showRenderer('auto');

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
      const renderer = value as CrumpleRenderer;
      apply({ renderer });
      showRenderer(renderer);
    },
  },
  {
    kind: 'range',
    label: 'Panel size',
    min: 80,
    max: 520,
    step: 10,
    value: 240,
    format: (value) => `${value}px`,
    onInput: (value) => apply({ scale: value }),
  },
  {
    kind: 'range',
    label: 'Depth',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.6,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ depth: value }),
  },
  {
    kind: 'range',
    label: 'Crease sharpness',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.65,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ creases: value }),
  },
  {
    kind: 'range',
    label: 'Light angle',
    min: 0,
    max: 360,
    step: 1,
    value: 135,
    format: (value) => `${value}°`,
    onInput: (value) => {
      light = value;
      angleReadout.textContent = `${value}°`;
      apply({ light: value });
    },
  },
  {
    kind: 'range',
    label: 'Light swing on scroll',
    min: 0,
    max: 180,
    step: 5,
    value: 0,
    format: (value) => (value === 0 ? 'off' : `${value}°`),
    onInput: (value) => {
      apply({ lightShift: value });
      angleReadout.textContent = value === 0 ? `${light}°` : `${light}° ±${value / 2}°`;
    },
  },
  {
    kind: 'range',
    label: 'Sheen',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.3,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ shine: value }),
  },
  {
    kind: 'range',
    label: 'Paper tone',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.35,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ tone: value }),
  },
  {
    kind: 'range',
    label: 'Soiling',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.4,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ soiling: value }),
  },
  {
    kind: 'range',
    label: 'Grain',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.4,
    format: (value) => value.toFixed(2),
    onInput: (value) => apply({ grain: value }),
  },
  {
    kind: 'range',
    label: 'Content warp',
    min: 0,
    max: 8,
    step: 0.5,
    value: 2,
    format: (value) => `${value}px`,
    onInput: (value) => apply({ warp: value }),
  },
  {
    kind: 'select',
    label: 'Paper stock',
    options: [
      { label: 'newsprint', value: '#f2ece0' },
      { label: 'bright white', value: '#fdfdfb' },
      { label: 'kraft', value: '#e6d3ae' },
      { label: 'aged', value: '#e9dcc0' },
    ],
    value: '#f2ece0',
    onInput: (value) => apply({ paperColor: value }),
  },
  {
    kind: 'button',
    label: 'Crumple again',
    onInput: () => {
      seed += 1;
      apply({ seed });
    },
  },
];

createControls(controlsHost, 'Crumpled Paper', controls);

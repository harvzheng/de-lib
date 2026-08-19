import '../../demo/demo.css';
import './effect.css';

import { createControls } from '../../demo/controls';
import { createFilmGrainVideo } from './index';
import type { FilmstockRenderer } from './index';

const background = document.querySelector<HTMLElement>('#filmstock-background');
const rack = document.querySelector<HTMLElement>('#filmstock-controls');
const fileInput = document.querySelector<HTMLInputElement>('#source-file');
const sourceStatus = document.querySelector<HTMLElement>('#source-status');
const compareState = document.querySelector<HTMLElement>('#compare-state');
const rendererState = document.querySelector<HTMLElement>('#active');

if (
  background === null ||
  rack === null ||
  fileInput === null ||
  sourceStatus === null ||
  compareState === null ||
  rendererState === null
) {
  throw new Error('Filmstock demo markup is incomplete.');
}
const demoBackground = background;
const controlsRack = rack;
const statusOutput = sourceStatus;
const comparisonOutput = compareState;
const rendererOutput = rendererState;

const effect = createFilmGrainVideo(demoBackground, {
  src: '/media/sample-1920.mp4',
  poster: '/media/sample-poster.jpg',
  flickerStyle: 'mixed',
});

let objectUrl: string | null = null;
let comparing = false;
let rawVideo: HTMLVideoElement | null = null;
/** The rack's flicker switch and its level are separate, so switching back on restores the level. */
let flickerOn = true;
let flickerAmount = 0.2;

function syncComparison(): void {
  rawVideo?.remove();
  rawVideo = null;
  if (!comparing) {
    comparisonOutput.textContent = 'Kodak Gold 200';
    return;
  }

  const video = effect.video;
  video.classList.add('filmstock-demo-raw-video');
  video.setAttribute('aria-hidden', 'true');
  demoBackground.appendChild(video);
  rawVideo = video;
  comparisonOutput.textContent = 'Original source';
}

function showRenderer(requested: FilmstockRenderer): void {
  const active = effect.activeRenderer;
  if (requested === active) rendererOutput.textContent = active;
  else if (requested === 'auto') rendererOutput.textContent = `auto → ${active}`;
  else rendererOutput.textContent = `${requested} → ${active} (unavailable)`;
}

showRenderer('auto');

createControls(controlsRack, 'Filmstock', [
  {
    kind: 'range',
    label: 'Frame hold',
    min: 6,
    max: 30,
    step: 1,
    value: 16,
    format: (value) => `${value} fps`,
    onInput: (value) => effect.setOptions({ fps: value }),
  },
  {
    kind: 'range',
    label: 'Speed',
    min: 0.25,
    max: 2,
    step: 0.05,
    value: 1,
    format: (value) => `${value.toFixed(2)}×`,
    onInput: (value) => effect.setOptions({ speed: value }),
  },
  {
    kind: 'range',
    label: 'Grain',
    min: 0,
    max: 2,
    step: 0.05,
    value: 0.85,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ grain: value }),
  },
  {
    kind: 'range',
    label: 'Grain size',
    min: 0.6,
    max: 5,
    step: 0.1,
    value: 1.6,
    format: (value) => `${value.toFixed(1)} px`,
    onInput: (value) => effect.setOptions({ grainSize: value }),
  },
  {
    kind: 'range',
    label: 'Halation',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.5,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ halation: value }),
  },
  {
    kind: 'range',
    label: 'Gate weave',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.4,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ gateWeave: value }),
  },
  {
    kind: 'range',
    label: 'Vignette',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.45,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ vignette: value }),
  },
  {
    kind: 'group',
    label: 'Flicker',
    controls: [
      {
        kind: 'toggle',
        label: 'Enabled',
        value: true,
        onInput: (value) => {
          flickerOn = value;
          effect.setOptions({ flicker: value ? flickerAmount : 0 });
        },
      },
      {
        kind: 'range',
        label: 'Amount',
        min: 0,
        max: 1,
        step: 0.05,
        value: 0.2,
        format: (value) => value.toFixed(2),
        onInput: (value) => {
          flickerAmount = value;
          // Moving the amount while flicker is switched off sets the level it will come
          // back at, rather than silently switching it on.
          if (flickerOn) effect.setOptions({ flicker: value });
        },
      },
      {
        kind: 'select',
        label: 'Style',
        options: [
          { label: 'Exposure', value: 'exposure' },
          { label: 'Projector', value: 'projector' },
          { label: 'Mixed', value: 'mixed' },
        ],
        value: 'mixed',
        onInput: (value) => {
          const flickerStyle =
            value === 'projector' ? 'projector' : value === 'mixed' ? 'mixed' : 'exposure';
          effect.setOptions({ flickerStyle });
        },
      },
      {
        kind: 'range',
        label: 'Rate',
        min: 0,
        max: 4,
        step: 0.1,
        value: 1.2,
        format: (value) => `${value.toFixed(1)}/s`,
        onInput: (value) => effect.setOptions({ flickerRate: value }),
      },
      {
        kind: 'range',
        label: 'Flash',
        min: 0,
        max: 1,
        step: 0.05,
        value: 0.35,
        format: (value) => value.toFixed(2),
        onInput: (value) => effect.setOptions({ flash: value }),
      },
      {
        kind: 'range',
        label: 'Shutter band',
        min: 0,
        max: 1,
        step: 0.05,
        value: 0.3,
        format: (value) => value.toFixed(2),
        onInput: (value) => effect.setOptions({ shutterBand: value }),
      },
      {
        kind: 'range',
        label: 'Colour breathing',
        min: 0,
        max: 1,
        step: 0.05,
        value: 0.25,
        format: (value) => value.toFixed(2),
        onInput: (value) => effect.setOptions({ colorBreathing: value }),
      },
    ],
  },
  {
    kind: 'range',
    label: 'Dust',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.3,
    format: (value) => value.toFixed(2),
    onInput: (value) => effect.setOptions({ dust: value }),
  },
  {
    kind: 'select',
    label: 'Look',
    options: [
      { label: 'Kodak Gold 200', value: 'kodak-gold-200' },
      { label: 'Neutral', value: 'neutral' },
    ],
    value: 'kodak-gold-200',
    onInput: (value) => {
      effect.setOptions({ look: value === 'neutral' ? 'neutral' : 'kodak-gold-200' });
    },
  },
  {
    kind: 'toggle',
    label: 'Show original',
    value: false,
    onInput: (value) => {
      comparing = value;
      syncComparison();
    },
  },
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
      const requested = value as FilmstockRenderer;
      effect.setOptions({ renderer: requested });
      showRenderer(requested);
    },
  },
]);

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (file === undefined) return;

  const nextUrl = URL.createObjectURL(file);
  statusOutput.textContent = `Loading ${file.name}…`;
  try {
    await effect.setSource(nextUrl);
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    objectUrl = nextUrl;
    statusOutput.textContent = file.name;
    if (comparing) syncComparison();
  } catch (error) {
    URL.revokeObjectURL(nextUrl);
    statusOutput.textContent = `Could not load ${file.name}`;
    throw error;
  }
});

window.addEventListener(
  'pagehide',
  () => {
    rawVideo?.remove();
    effect.destroy();
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  },
  { once: true },
);

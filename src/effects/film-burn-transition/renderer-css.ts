/**
 * CSS/SVG burn renderer — the floor that works without a GPU, and the reason
 * this effect is allowed to reach for WebGL at all.
 *
 * There is no baked mask sequence here. A live `feTurbulence` field is biased
 * towards the burn origin, thresholded five times by `feComponentTransfer`, and
 * cut into a hole plus four concentric bands with `feComposite`. Only the
 * threshold ramps move per frame, which is what `handle.set` on a primitive
 * tagged `data-p` is for.
 */

import { createLayer, onVisible } from '../../core/dom';
import { clamp01, mulberry32 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { createFilter } from '../../core/svg';
import type { BurnConfig, BurnMedia, BurnOrigin, BurnRendererInstance } from './index';

/**
 * Field units the threshold ramp spans. The reciprocal is the feFuncA slope, so
 * anything smaller starts quantising against the 8-bit filter pipeline.
 */
const SOFTNESS = 0.012;

/** Band outer edges as multiples of the rim width, innermost first. */
const WHITE_BAND = 0.3;
const CHAR_BAND = 1.4;
const HEAT_BAND = 2.0;

/**
 * The WebGL renderer measures the field's local gradient with fwidth and gets an
 * exact rim thickness; nothing in SVG filters can. This is the flat conversion
 * from `edge` frame-heights to field units, with a ceiling so a wide `edge` on a
 * blotchy `scale` cannot wash the whole frame amber. Tuned against the WebGL
 * renderer by eye.
 */
const RIM_FIELD_GAIN = 0.9;
const RIM_FIELD_MAX = 0.085;

const GRAIN_FPS = 24;
const GRAIN_STEPS = 12;
const FLICKER_FPS = 17;

const FILTER_MARKUP = `
<filter color-interpolation-filters="sRGB" x="-8%" y="-8%" width="116%" height="116%">
  <feTurbulence data-p="noise" type="fractalNoise" baseFrequency="0.006" numOctaves="4"
    seed="1" stitchTiles="noStitch" result="raw"/>

  <!-- Measured: this feTurbulence puts its 2nd and 98th percentiles at 0.24 and
       0.76, so this ramp is what makes the threshold sweep span the frame. -->
  <feComponentTransfer in="raw" result="norm">
    <feFuncA type="linear" slope="1.74" intercept="-0.365"/>
  </feComponentTransfer>

  <!-- The flood covers half the frame and blur preserves mean, so the blob
       averages 0.5 and the bias below shifts where the burn starts without
       shifting how much of the frame is gone at a given progress. The blur
       needs its own subregion or it is clipped to the flood rect. -->
  <feFlood data-p="originSeed" flood-color="#ffffff" x="0" y="0" width="1" height="1"
    result="originSeed"/>
  <feGaussianBlur data-p="originBlur" in="originSeed" stdDeviation="1" x="0" y="0"
    width="1" height="1" result="originBlob"/>
  <feComposite data-p="bias" in="norm" in2="originBlob" operator="arithmetic"
    k1="0" k2="1" k3="-0.55" k4="0.275" result="field"/>

  <feComponentTransfer in="field" result="m0">
    <feFuncA data-p="m0" type="linear" slope="83" intercept="4"/>
  </feComponentTransfer>
  <feComponentTransfer in="field" result="mWhite">
    <feFuncA data-p="mWhite" type="linear" slope="83" intercept="4"/>
  </feComponentTransfer>
  <feComponentTransfer in="field" result="mRim">
    <feFuncA data-p="mRim" type="linear" slope="83" intercept="4"/>
  </feComponentTransfer>
  <feComponentTransfer in="field" result="mChar">
    <feFuncA data-p="mChar" type="linear" slope="83" intercept="4"/>
  </feComponentTransfer>
  <feComponentTransfer in="field" result="mHeat">
    <feFuncA data-p="mHeat" type="linear" slope="83" intercept="4"/>
  </feComponentTransfer>

  <feComposite in="SourceGraphic" in2="m0" operator="in" result="paper"/>

  <feComposite in="m0" in2="mHeat" operator="out" result="heatBand"/>
  <feColorMatrix in="SourceGraphic" type="matrix" result="hotImage"
    values="1.80 0 0 0 0.05  0 1.75 0 0 0.03  0 0 1.70 0 0  0 0 0 1 0"/>
  <feComposite in="hotImage" in2="heatBand" operator="in" result="hotClip"/>
  <feComponentTransfer in="hotClip" result="hot">
    <feFuncA data-p="hotFade" type="linear" slope="0" intercept="0"/>
  </feComponentTransfer>

  <feComposite in="m0" in2="mChar" operator="out" result="charBand"/>
  <feFlood data-p="charFlood" flood-color="#2a1206" flood-opacity="0" result="charColour"/>
  <feComposite in="charColour" in2="charBand" operator="in" result="charLayer"/>

  <feComposite in="m0" in2="mRim" operator="out" result="rimBand"/>
  <feFlood data-p="rimFlood" flood-color="#ff7a1a" flood-opacity="0" result="rimColour"/>
  <feComposite in="rimColour" in2="rimBand" operator="in" result="rimLayer"/>
  <feGaussianBlur data-p="glow" in="rimLayer" stdDeviation="6" result="rimGlow"/>

  <feComposite in="m0" in2="mWhite" operator="out" result="whiteBand"/>
  <feFlood data-p="whiteFlood" flood-color="#fff3dc" flood-opacity="0" result="whiteColour"/>
  <feComposite in="whiteColour" in2="whiteBand" operator="in" result="whiteLayer"/>

  <feMerge>
    <feMergeNode in="paper"/>
    <feMergeNode in="hot"/>
    <feMergeNode in="charLayer"/>
    <feMergeNode in="rimGlow"/>
    <feMergeNode in="rimLayer"/>
    <feMergeNode in="whiteLayer"/>
  </feMerge>
</filter>`;

/** A type alias, not an interface: `FilterHandle.set` takes an index signature. */
type OriginRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The flood a large blur turns into the origin gradient. Every case covers half
 * the frame's area, which is what puts the blurred blob's mean at 0.5.
 */
function originRect(origin: BurnOrigin, width: number, height: number): OriginRect {
  switch (origin) {
    case 'left':
      return { x: 0, y: 0, width: width / 2, height };
    case 'right':
      return { x: width / 2, y: 0, width: width / 2, height };
    case 'top':
      return { x: 0, y: 0, width, height: height / 2 };
    case 'bottom':
      return { x: 0, y: height / 2, width, height: height / 2 };
    default: {
      const halfArea = Math.SQRT1_2;
      return {
        x: (width * (1 - halfArea)) / 2,
        y: (height * (1 - halfArea)) / 2,
        width: width * halfArea,
        height: height * halfArea,
      };
    }
  }
}

/**
 * The stack owns what it displays, so an element that is already on the page is
 * copied rather than torn out of the caller's layout.
 */
function displayElement(media: BurnMedia): BurnMedia {
  if (!media.isConnected) return media;
  if (media instanceof HTMLVideoElement) {
    const video = document.createElement('video');
    video.crossOrigin = media.crossOrigin;
    // Set before playback is requested or autoplay is refused.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = media.loop;
    video.src = media.currentSrc || media.src;
    return video;
  }
  const image = new Image();
  image.crossOrigin = media.crossOrigin;
  image.src = media.currentSrc || media.src;
  return image;
}

/** Grain jumps between these tile offsets; the seed keeps the jitter repeatable. */
function buildGrainOffsets(seed: number): string[] {
  const random = mulberry32(seed);
  const offsets: string[] = [];
  for (let i = 0; i < GRAIN_STEPS; i += 1) {
    offsets.push(`${Math.round(random() * 160)}px ${Math.round(random() * 160)}px`);
  }
  return offsets;
}

export function createCssBurnRenderer(host: HTMLElement, initial: BurnConfig): BurnRendererInstance {
  const stack = createLayer(host, 'div', 'film-burn-stack');
  const frame = document.createElement('div');
  frame.className = 'film-burn-frame';
  const toLayer = document.createElement('div');
  toLayer.className = 'film-burn-layer film-burn-to';
  const fromLayer = document.createElement('div');
  fromLayer.className = 'film-burn-layer film-burn-from';
  const grainLayer = document.createElement('div');
  grainLayer.className = 'film-burn-grain';
  frame.append(toLayer, fromLayer, grainLayer);
  stack.append(frame);

  const filter = createFilter(FILTER_MARKUP, 'film-burn');
  fromLayer.style.filter = filter.css;

  let config = initial;
  let sourceFrom: BurnMedia | null = null;
  let sourceTo: BurnMedia | null = null;
  let shownFrom: BurnMedia | null = null;
  let shownTo: BurnMedia | null = null;
  let progress = 0;
  let time = 0;
  let reduced = prefersReducedMotion();
  let visible = true;
  let stopTick: (() => void) | null = null;
  let destroyed = false;
  let grainOffsets = buildGrainOffsets(config.seed);

  function setThreshold(name: string, value: number): void {
    filter.set(name, { slope: 1 / SOFTNESS, intercept: 0.5 - value / SOFTNESS });
  }

  function paint(): void {
    // Overshoots both ends so progress 0 and 1 are clean frames.
    const threshold = -0.05 + progress * 1.1;
    const rim = Math.min(config.edge * config.scale * RIM_FIELD_GAIN, RIM_FIELD_MAX);

    setThreshold('m0', threshold);
    setThreshold('mWhite', threshold + rim * WHITE_BAND);
    setThreshold('mRim', threshold + rim);
    setThreshold('mChar', threshold + rim * CHAR_BAND);
    setThreshold('mHeat', threshold + rim * HEAT_BAND);

    const step = Math.floor(time * FLICKER_FPS);
    const wobble = Math.sin(step * 12.9898 + config.seed * 78.233) * 43758.5453;
    const flicker = reduced ? 1 : 1 + 0.14 * (wobble - Math.floor(wobble) - 0.5);
    // Nothing is alight below this: without it the noise floor glows at rest.
    const ignition = clamp01(progress / 0.04);

    filter.set('whiteFlood', { 'flood-opacity': ignition * flicker });
    filter.set('rimFlood', { 'flood-opacity': ignition * flicker });
    filter.set('charFlood', { 'flood-opacity': ignition * 0.9 });
    filter.set('hotFade', { slope: ignition * 0.75 });
  }

  function mount(layer: HTMLElement, media: BurnMedia | null): BurnMedia | null {
    layer.replaceChildren();
    if (media === null) return null;
    const element = displayElement(media);
    layer.append(element);
    return element;
  }

  function applyConfig(): void {
    filter.set('noise', { seed: config.seed });
    filter.set('rimFlood', { 'flood-color': config.burnColor });
    filter.set('charFlood', { 'flood-color': config.charColor });
    // Centred on zero, so biasing moves where the burn starts without moving
    // the field's mean and running the whole frame out ahead of progress.
    const bias = config.origin === 'none' ? 0 : 0.55;
    filter.set('bias', { k3: -bias, k4: bias / 2 });
    grainLayer.style.opacity = String(clamp01(config.grain) * 0.5);
    grainOffsets = buildGrainOffsets(config.seed);

    if (config.from !== sourceFrom) {
      sourceFrom = config.from;
      shownFrom = mount(fromLayer, config.from);
    }
    if (config.to !== sourceTo) {
      sourceTo = config.to;
      shownTo = mount(toLayer, config.to);
    }
  }

  function syncActivity(): void {
    const animating = shownFrom !== null && shownTo !== null && visible && !reduced && !destroyed;

    for (const media of [shownFrom, shownTo]) {
      if (!(media instanceof HTMLVideoElement)) continue;
      if (animating) {
        void media.play().catch((error: unknown) => {
          console.warn('film-burn-transition: video playback was refused.', error);
        });
      } else {
        media.pause();
      }
    }

    if (animating && stopTick === null) {
      let painted = -1;
      stopTick = onTick((_now, deltaMs) => {
        time += deltaMs / 1000;
        // Grain steps on exposed frames, not display frames, or it reads as
        // digital noise; the ember flicker rides the same schedule.
        const step = Math.floor(time * GRAIN_FPS);
        if (step === painted) return;
        painted = step;
        grainLayer.style.backgroundPosition = grainOffsets[step % GRAIN_STEPS];
        paint();
      });
    } else if (!animating && stopTick !== null) {
      stopTick();
      stopTick = null;
    }
  }

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncActivity();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    syncActivity();
    if (reduced) paint();
  });

  applyConfig();
  paint();

  return {
    setProgress(value: number): void {
      progress = value;
      paint();
    },

    setOptions(next: BurnConfig): void {
      config = next;
      applyConfig();
      syncActivity();
      paint();
    },

    resize(): void {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      // A not-yet-laid-out frame keeps the previous geometry.
      if (width === 0 || height === 0) return;

      filter.set('noise', { baseFrequency: (config.scale / height).toFixed(6) });
      filter.set('originSeed', originRect(config.origin, width, height));
      filter.set('originBlur', {
        stdDeviation: (Math.min(width, height) * 0.22).toFixed(2),
        x: -width * 0.1,
        y: -height * 0.1,
        width: width * 1.2,
        height: height * 1.2,
      });
      // The glow blurs both ways, so a wide one tints the revealed shot through
      // the hole rather than lighting the paper around it.
      filter.set('glow', { stdDeviation: (height * config.edge * 0.35).toFixed(2) });
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopVisible();
      stopMotion();
      for (const media of [shownFrom, shownTo]) {
        if (media instanceof HTMLVideoElement) media.pause();
      }
      filter.destroy();
      stack.remove();
    },
  };
}

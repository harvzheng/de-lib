/**
 * CSS/SVG leak renderer — the floor that works without a GPU, and the reason
 * this effect is allowed to reach for WebGL at all.
 *
 * The leak is a stack of wide blurred gradients composited with `screen` and
 * `color-dodge` over the two shots; one SVG filter displaces the leak edge
 * through `feTurbulence`, a second thresholds the outgoing shot's luminance and
 * blurs the result into an amber halation. Per frame only custom properties,
 * opacities and transforms move — every filter primitive is written on option
 * changes alone, because writing one re-rasterises the whole filtered layer.
 */

import { createLayer, onVisible } from '../../core/dom';
import { clamp01, mulberry32 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { createFilter } from '../../core/svg';
import {
  buildSweepBands,
  computeLeakStage,
  createLeakStage,
  leakDrift,
  leakFlicker,
  sweepBandPlacement,
} from './leaks';
import type { SweepBandGeometry } from './leaks';
import type { LeakConfig, LeakMedia, LeakRendererInstance } from './index';

type StageVar =
  | '--from-opacity'
  | '--exposure'
  | '--core-opacity'
  | '--halation-opacity'
  | '--grain-opacity'
  | '--softness'
  | '--leak-red'
  | '--leak-amber'
  | '--leak-magenta';

const GRAIN_STEP_MS = 1000 / 12;
const FLICKER_STEP_MS = 1000 / 18;
const GRAIN_TILE_PX = 160;
const GRAIN_STEPS = 12;

const ORGANIC_FILTER = `
  <filter x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">
    <feTurbulence data-p="noise" type="fractalNoise" baseFrequency="0.012" numOctaves="3"
      seed="1" result="rough" />
    <feDisplacementMap data-p="displace" in="SourceGraphic" in2="rough" scale="18"
      xChannelSelector="R" yChannelSelector="G" />
  </filter>
`;

const HALATION_FILTER = `
  <filter x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feColorMatrix type="luminanceToAlpha" result="luma" />
    <feComponentTransfer in="luma" result="mask">
      <feFuncA data-p="threshold" type="discrete" tableValues="0 0 0 0 0 0 0.5 1" />
    </feComponentTransfer>
    <feComposite in="SourceGraphic" in2="mask" operator="in" result="highlights" />
    <feColorMatrix in="highlights" type="matrix" result="amber"
      values="1.00 0.24 0.08 0 0
              0.20 0.46 0.05 0 0
              0.03 0.04 0.16 0 0
              0    0    0    1 0" />
    <feGaussianBlur data-p="bleed" in="amber" stdDeviation="12" />
  </filter>
`;

/** The eight discrete bands `feFuncA` thresholds the outgoing luminance into. */
function halationThreshold(amount: number): string {
  const edge = 0.86 - clamp01(amount) * 0.3;
  const bands: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const centre = (index + 0.5) / 8;
    bands.push(clamp01((centre - edge) / 0.16).toFixed(3));
  }
  return bands.join(' ');
}

/** Grain jumps between these tile offsets; the seed keeps the jitter repeatable. */
function buildGrainOffsets(seed: number): string[] {
  const random = mulberry32(seed ^ 0x2c9277);
  return Array.from({ length: GRAIN_STEPS }, () => {
    const x = Math.round(random() * GRAIN_TILE_PX);
    const y = Math.round(random() * GRAIN_TILE_PX);
    return `${x}px ${y}px`;
  });
}

/**
 * The stack owns what it displays, so an element that is already on the page is
 * copied rather than torn out of the caller's layout. Both the outgoing shot and
 * the halation layer need their own copy.
 */
function displayElement(media: LeakMedia): LeakMedia {
  if (media instanceof HTMLVideoElement) {
    const video = document.createElement('video');
    video.crossOrigin = media.crossOrigin;
    // Set before playback is requested, or autoplay is refused.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = media.loop;
    video.poster = media.poster;
    video.src = media.currentSrc || media.src;
    return video;
  }
  const image = new Image();
  image.crossOrigin = media.crossOrigin;
  image.decoding = 'async';
  image.alt = '';
  image.src = media.currentSrc || media.src;
  return image;
}

export function createCssLeakRenderer(host: HTMLElement, initial: LeakConfig): LeakRendererInstance {
  let config = initial;
  let progress = 0;
  let bandGeometry = buildSweepBands(config.seed);
  let grainOffsets = buildGrainOffsets(config.seed);
  let geometrySeed = Number.NaN;
  let writtenOrganic = Number.NaN;
  let writtenOrganicSeed = Number.NaN;
  let writtenThreshold = Number.NaN;
  let writtenBleed = Number.NaN;
  let sourceFrom: LeakMedia | null = null;
  let sourceTo: LeakMedia | null = null;
  let shownFrom: LeakMedia | null = null;
  let shownTo: LeakMedia | null = null;
  let shownHalation: LeakMedia | null = null;
  let reduced = prefersReducedMotion();
  let visible = true;
  let destroyed = false;
  let flicker = 1;
  let elapsedMs = 0;
  let grainElapsedMs = 0;
  let flickerElapsedMs = 0;
  let stopTick: (() => void) | null = null;

  const leakStage = createLeakStage();
  const drift = new Float32Array(2);
  const placement = new Float32Array(3);

  const stack = createLayer(host, 'div', 'light-leak-transition-stage');
  stack.setAttribute('aria-hidden', 'true');
  const frame = document.createElement('div');
  frame.className = 'light-leak-transition-frame';
  stack.appendChild(frame);

  const toLayer = createLayer(frame, 'div', 'light-leak-transition-layer light-leak-transition-to');
  const fromLayer = createLayer(
    frame,
    'div',
    'light-leak-transition-layer light-leak-transition-from',
  );
  const halationLayer = createLayer(frame, 'div', 'light-leak-transition-halation');
  const leakLayer = createLayer(frame, 'div', 'light-leak-transition-leak');
  const leakContent = document.createElement('div');
  leakContent.className = 'light-leak-transition-leak-content';
  const flashBody = document.createElement('div');
  flashBody.className = 'light-leak-transition-flash-body';
  const flashCore = document.createElement('div');
  flashCore.className = 'light-leak-transition-flash-core';
  const sweepBands = Array.from({ length: 3 }, () => {
    const band = document.createElement('div');
    band.className = 'light-leak-transition-sweep-band';
    return band;
  });
  leakContent.append(flashBody, flashCore, ...sweepBands);
  leakLayer.appendChild(leakContent);
  const grainLayer = createLayer(frame, 'div', 'light-leak-transition-grain');

  const organicFilter = createFilter(ORGANIC_FILTER, 'light-leak-transition-organic');
  const halationFilter = createFilter(HALATION_FILTER, 'light-leak-transition-halation');
  leakLayer.style.filter = organicFilter.css;
  leakLayer.style.inset = '-45%';
  halationLayer.style.filter = halationFilter.css;

  /** Custom properties inherit, so every write invalidates style for the whole stack
   *  subtree. Skipping unchanged writes is what makes an idle endpoint cost nothing. */
  const written: Partial<Record<StageVar, string>> = {};
  function setVar(name: StageVar, value: string): void {
    if (written[name] === value) return;
    written[name] = value;
    stack.style.setProperty(name, value);
  }

  /* CSSOM renormalises what it serialises, so a read-back never compares equal to
     what was written; the last written string is kept instead. */
  let writtenLeakOpacity = '';
  let writtenLeakTransform = '';
  let writtenLeakContentTransform = '';

  function mediaElements(): LeakMedia[] {
    return [shownFrom, shownTo, shownHalation].filter(
      (media): media is LeakMedia => media !== null,
    );
  }

  function syncMediaPlayback(): void {
    const shouldPlay = visible && !reduced && !destroyed;
    for (const media of mediaElements()) {
      if (!(media instanceof HTMLVideoElement)) continue;
      if (shouldPlay) {
        void media.play().catch((error: unknown) => {
          console.warn('light-leak-transition: video playback was refused.', error);
        });
      } else {
        media.pause();
      }
    }
  }

  function mount(layer: HTMLElement, media: LeakMedia | null): LeakMedia | null {
    layer.replaceChildren();
    if (media === null) return null;
    const element = displayElement(media);
    layer.appendChild(element);
    return element;
  }

  function applyLeakOpacity(): void {
    const value = (leakStage.leakOpacity * flicker).toFixed(4);
    if (writtenLeakOpacity === value) return;
    writtenLeakOpacity = value;
    leakLayer.style.opacity = value;
  }

  function applyBandTransforms(): void {
    for (let index = 0; index < sweepBands.length; index += 1) {
      const geometry = bandGeometry[index] as SweepBandGeometry;
      sweepBandPlacement(geometry, leakStage, placement, 0);
      (sweepBands[index] as HTMLDivElement).style.transform =
        `translate3d(${placement[0].toFixed(2)}%, ${placement[1].toFixed(2)}%, 0) ` +
        `rotate(${placement[2].toFixed(2)}deg) scale(${geometry.scale.toFixed(3)})`;
    }
  }

  function paint(): void {
    computeLeakStage(config, progress, leakStage);

    setVar('--from-opacity', leakStage.fromOpacity.toFixed(4));
    setVar('--exposure', leakStage.exposure.toFixed(4));
    setVar('--core-opacity', leakStage.coreOpacity.toFixed(4));
    setVar('--halation-opacity', leakStage.halationOpacity.toFixed(4));
    setVar('--grain-opacity', leakStage.grainOpacity.toFixed(4));

    const transform = `translate3d(${leakStage.offsetX.toFixed(2)}%, ${leakStage.offsetY.toFixed(
      2,
    )}%, 0) rotate(${leakStage.angle}deg) scale(${leakStage.scale.toFixed(3)})`;
    if (writtenLeakTransform !== transform) {
      writtenLeakTransform = transform;
      leakLayer.style.transform = transform;
    }
    if (config.style === 'sweep') applyBandTransforms();
    applyLeakOpacity();
    syncActivity();
  }

  function applyGeometry(): void {
    stack.dataset.direction = config.direction;

    if (config.seed !== geometrySeed) {
      geometrySeed = config.seed;
      bandGeometry = buildSweepBands(config.seed);
      grainOffsets = buildGrainOffsets(config.seed);
      grainLayer.style.backgroundPosition = grainOffsets[0] as string;
      for (let index = 0; index < sweepBands.length; index += 1) {
        const geometry = bandGeometry[index] as SweepBandGeometry;
        (sweepBands[index] as HTMLDivElement).style.setProperty(
          '--band-width',
          `${geometry.width.toFixed(2)}%`,
        );
      }
    }

    // Writing a filter primitive invalidates the whole filtered layer's raster, so
    // each primitive is only touched when a value that actually feeds it has moved.
    const organic = clamp01(config.organic);
    if (organic !== writtenOrganic || config.seed !== writtenOrganicSeed) {
      writtenOrganic = organic;
      writtenOrganicSeed = config.seed;
      organicFilter.set('noise', {
        seed: config.seed,
        baseFrequency: (0.006 + organic * 0.018).toFixed(4),
      });
      organicFilter.set('displace', { scale: (organic * 52).toFixed(2) });
    }

    const threshold = clamp01(config.halation);
    if (threshold !== writtenThreshold) {
      writtenThreshold = threshold;
      halationFilter.set('threshold', { tableValues: halationThreshold(threshold) });
    }

    const bleed = 6 + Math.max(0, config.softness) * 0.13;
    if (bleed !== writtenBleed) {
      writtenBleed = bleed;
      halationFilter.set('bleed', { stdDeviation: bleed.toFixed(2) });
    }
  }

  function applyConfig(): void {
    stack.dataset.style = config.style;
    const warmth = clamp01(config.warmth);
    setVar('--softness', `${Math.max(0, config.softness).toFixed(2)}px`);
    setVar(
      '--leak-red',
      `hsl(${(4 + warmth * 19).toFixed(1)} 100% ${(39 + warmth * 17).toFixed(1)}%)`,
    );
    setVar(
      '--leak-amber',
      `hsl(${(19 + warmth * 24).toFixed(1)} 100% ${(55 + warmth * 23).toFixed(1)}%)`,
    );
    setVar(
      '--leak-magenta',
      `hsl(${(334 + warmth * 20).toFixed(1)} 94% ${(45 + warmth * 17).toFixed(1)}%)`,
    );

    if (config.from !== sourceFrom) {
      sourceFrom = config.from;
      shownFrom = mount(fromLayer, config.from);
      shownHalation = mount(halationLayer, config.from);
    }
    if (config.to !== sourceTo) {
      sourceTo = config.to;
      shownTo = mount(toLayer, config.to);
    }

    applyGeometry();
    paint();
  }

  /** Flare flicker and body drift. Frozen time holds whatever frame was last written. */
  function updateAutonomousMotion(): void {
    flicker = leakFlicker(elapsedMs, config.seed);
    leakDrift(elapsedMs, config.seed, drift);
    const transform = `translate3d(${drift[0].toFixed(2)}px, ${drift[1].toFixed(2)}px, 0)`;
    if (writtenLeakContentTransform !== transform) {
      writtenLeakContentTransform = transform;
      leakContent.style.transform = transform;
    }
    applyLeakOpacity();
  }

  function tick(_now: number, deltaMs: number): void {
    elapsedMs += deltaMs;
    flickerElapsedMs += deltaMs;
    if (flickerElapsedMs >= FLICKER_STEP_MS) {
      flickerElapsedMs %= FLICKER_STEP_MS;
      updateAutonomousMotion();
    }

    if (leakStage.grainOpacity > 0) {
      grainElapsedMs += deltaMs;
      if (grainElapsedMs >= GRAIN_STEP_MS) {
        grainElapsedMs %= GRAIN_STEP_MS;
        const step = Math.floor(elapsedMs / GRAIN_STEP_MS) % GRAIN_STEPS;
        grainLayer.style.backgroundPosition = grainOffsets[step] as string;
      }
    }
  }

  function syncActivity(): void {
    const wanted =
      visible &&
      !reduced &&
      !destroyed &&
      (leakStage.leakOpacity > 0 || leakStage.grainOpacity > 0);
    if (wanted && stopTick === null) stopTick = onTick(tick);
    else if (!wanted && stopTick !== null) {
      stopTick();
      stopTick = null;
    }
  }

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncActivity();
    syncMediaPlayback();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    syncActivity();
    syncMediaPlayback();
  });

  updateAutonomousMotion();
  applyConfig();

  return {
    setProgress(value: number): void {
      progress = value;
      paint();
    },

    setOptions(next: LeakConfig): void {
      config = next;
      applyConfig();
      syncMediaPlayback();
    },

    resize(): void {
      // Nothing here is sized in device pixels: the turbulence baseFrequency, the
      // gradient blurs and the halation bleed are all authored in CSS px.
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopVisible();
      stopMotion();
      for (const media of mediaElements()) {
        if (media instanceof HTMLVideoElement) media.pause();
      }
      organicFilter.destroy();
      halationFilter.destroy();
      stack.remove();
    },
  };
}

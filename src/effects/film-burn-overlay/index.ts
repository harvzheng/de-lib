/**
 * Film Burn Overlay — a sustained burn-and-light-leak treatment over a single
 * image. Unlike the burn transition, this never completes: holes bloom open
 * and stay charred, light leaks sweep and drift, embers flicker, and the
 * image itself drifts and swells slightly as the reader scrolls through it.
 *
 * CSS layers, blend modes, and one SVG roughening filter on the char layer —
 * no canvas, no WebGL. The image's parallax/zoom and the vignette are plain
 * `calc()` off a `--p` custom property, since each is one static formula on
 * one element. Hole geometry, ember flicker, and light-leak drift combine a
 * transform *and* an opacity *and* (for embers/leaks) elapsed time on the
 * same element, so JS resolves those directly to `style.opacity` /
 * `style.transform` on progress and on a throttled tick — cheap, since it is
 * at most sixteen hole elements and three leak blobs, never per-frame CSS
 * recalculation of a filtered, blended layer.
 */

import { createLayer, onResize, onVisible } from '../../core/dom';
import { clamp, clamp01 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { onScrollProgress } from '../../core/scroll';
import { createFilter } from '../../core/svg';
import { buildBurnHoles } from './holes';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { FilterHandle } from '../../core/svg';
import type { Effect } from '../../core/types';

export interface FilmBurnOverlayOptions {
  /** Image URL. Omit to treat an <img> already inside the host. */
  src?: string;
  /** Scroll mapping. Default `{ start: 1, end: 0 }` — the whole travel through the viewport. Pass false to drive it yourself. */
  scroll?: ScrollProgressOptions | false;
  /** Starting progress when `scroll` is false. Default 0. */
  progress?: number;
  /** Overall strength of the treatment, 0..1. Default 0.7. */
  intensity?: number;
  /** Light-leak strength, 0..1. Default 0.6. */
  leak?: number;
  /** Number of burn-through holes, 0..8. Default 4. */
  holes?: number;
  /** Ember rim brightness, 0..1. Default 0.7. */
  ember?: number;
  /** Vertical drift of the image across the scroll range, in px. Default 60. */
  parallax?: number;
  /** Extra scale at progress 1. Default 0.08. */
  zoom?: number;
  /** Grain strength, 0..1. Default 0.4. */
  grain?: number;
  /** Ignition colour. Default '#ff7a1a'. */
  burnColor?: string;
  /** Charred colour. Default '#1b0d05'. */
  charColor?: string;
  /** Embers flicker over time. Default true. */
  flicker?: boolean;
  /** PRNG seed; same seed, same holes. Default 1. */
  seed?: number;
}

export interface FilmBurnOverlayHandle extends Effect<FilmBurnOverlayOptions> {
  /** Drives the treatment manually, 0..1. Only meaningful when `scroll` is false. */
  setProgress(progress: number): void;
}

type Resolved = Required<Omit<FilmBurnOverlayOptions, 'src'>> & Pick<FilmBurnOverlayOptions, 'src'>;

interface LeakBlobSeed {
  baseX: number;
  baseY: number;
  sweep: number;
  phase: number;
  /** 'burn' reuses the ignition colour, 'red' is the fixed deep-red constant below. */
  hue: 'burn' | 'red';
}

interface HoleState {
  char: HTMLDivElement;
  ember: HTMLDivElement;
  onset: number;
  span: number;
  variance: number;
  /** Cached 0..1 bloom fraction, refreshed on progress change and read back by the flicker tick. */
  open: number;
}

interface LeakBlobState {
  el: HTMLDivElement;
  baseX: number;
  baseY: number;
  sweep: number;
  phase: number;
}

const DEEP_RED = '#8f1d0a';
const MAX_HOLES = 8;
/** ~12 steps/sec: fast enough to read as grain, slow enough to read as film rather than TV static. */
const GRAIN_STEP_MS = 1000 / 12;
const GRAIN_TILE_PX = 180;
/**
 * Ember flicker and light-leak drift are slow sine motion — 20 Hz reads as
 * smooth while cutting how often the (blurred/filtered) layers repaint.
 */
const TIME_STEP_MS = 1000 / 20;

/**
 * Roughens the char layer's hole edges so they read as burnt paper rather
 * than a clip-art circle. Char only: it changes with scroll, not with time,
 * so the (expensive) turbulence + displacement only recomputes on scroll.
 * The ember layer stays a plain blurred gradient for the same reason.
 */
const ROUGH_FILTER = `
  <filter color-interpolation-filters="sRGB">
    <feTurbulence data-p="turbulence" type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="1" result="rough" />
    <feDisplacementMap data-p="displace" in="SourceGraphic" in2="rough" scale="18" xChannelSelector="R" yChannelSelector="G" />
  </filter>
`;

const LEAK_BLOBS: readonly LeakBlobSeed[] = [
  { baseX: 6, baseY: 20, sweep: 55, phase: 0, hue: 'burn' },
  { baseX: 58, baseY: 62, sweep: -42, phase: 2.4, hue: 'red' },
  { baseX: 28, baseY: 84, sweep: 34, phase: 4.6, hue: 'burn' },
];

const DEFAULTS: Resolved = {
  scroll: { start: 1, end: 0 },
  progress: 0,
  intensity: 0.7,
  leak: 0.6,
  holes: 4,
  ember: 0.7,
  parallax: 60,
  zoom: 0.08,
  grain: 0.4,
  burnColor: '#ff7a1a',
  charColor: '#1b0d05',
  flicker: true,
  seed: 1,
  src: undefined,
};

function resolve(base: Resolved, patch: FilmBurnOverlayOptions): Resolved {
  return {
    scroll: patch.scroll ?? base.scroll,
    progress: patch.progress ?? base.progress,
    intensity: patch.intensity ?? base.intensity,
    leak: patch.leak ?? base.leak,
    holes: patch.holes ?? base.holes,
    ember: patch.ember ?? base.ember,
    parallax: patch.parallax ?? base.parallax,
    zoom: patch.zoom ?? base.zoom,
    grain: patch.grain ?? base.grain,
    burnColor: patch.burnColor ?? base.burnColor,
    charColor: patch.charColor ?? base.charColor,
    flicker: patch.flicker ?? base.flicker,
    seed: patch.seed ?? base.seed,
    src: patch.src ?? base.src,
  };
}

export function createFilmBurnOverlay(
  host: HTMLElement,
  options: FilmBurnOverlayOptions = {},
): FilmBurnOverlayHandle {
  let config = resolve(DEFAULTS, options);

  // Hiding rather than moving the source `<img>` keeps it in normal flow, so
  // a host that was only sized by that image keeps its size once it is hidden.
  let sourceImg: HTMLImageElement | null = null;
  let sourceImgVisibility = '';
  if (config.src === undefined) {
    const existing = host.querySelector('img');
    if (existing === null) {
      throw new Error('createFilmBurnOverlay: host has no <img> and no `src` option was given');
    }
    sourceImg = existing;
    sourceImgVisibility = existing.style.visibility;
    existing.style.visibility = 'hidden';
  }

  const stage = createLayer(host, 'div', 'film-burn-overlay-stage');
  stage.setAttribute('aria-hidden', 'true');

  const image = createLayer(stage, 'img', 'film-burn-overlay-image');
  image.alt = '';
  image.decoding = 'async';
  image.src = config.src ?? ((sourceImg as HTMLImageElement).currentSrc || (sourceImg as HTMLImageElement).src);

  const char = createLayer(stage, 'div', 'film-burn-overlay-char');
  const ember = createLayer(stage, 'div', 'film-burn-overlay-ember');
  const leak = createLayer(stage, 'div', 'film-burn-overlay-leak');
  const grain = createLayer(stage, 'div', 'film-burn-overlay-grain');
  createLayer(stage, 'div', 'film-burn-overlay-vignette');

  const filter: FilterHandle = createFilter(ROUGH_FILTER, 'film-burn-overlay-rough');
  ember.style.filter = 'blur(1.4px)';

  let holeStates: HoleState[] = [];

  const leakStates: LeakBlobState[] = LEAK_BLOBS.map((blob) => {
    const el = document.createElement('div');
    el.className = 'film-burn-overlay-leak-blob';
    el.style.setProperty('--leak-color', blob.hue === 'red' ? DEEP_RED : 'var(--burn-color)');
    leak.appendChild(el);
    return { el, baseX: blob.baseX, baseY: blob.baseY, sweep: blob.sweep, phase: blob.phase };
  });

  let boxWidth = -1;
  let boxHeight = -1;
  let progress = clamp01(config.scroll === false ? config.progress : 0);
  let reduced = prefersReducedMotion();
  let visible = true;
  let elapsedSeconds = 0;
  let grainElapsedMs = 0;
  let timeWriteMs = 0;
  let stopTick: (() => void) | null = null;
  let stopScroll: (() => void) | null = null;
  let destroyed = false;

  function applyOptionVars(): void {
    stage.style.setProperty('--p', String(progress));
    stage.style.setProperty('--intensity', String(config.intensity));
    stage.style.setProperty('--parallax', String(config.parallax));
    stage.style.setProperty('--zoom', String(config.zoom));
    stage.style.setProperty('--grain', String(config.grain));
    stage.style.setProperty('--char-color', config.charColor);
    stage.style.setProperty('--burn-color', config.burnColor);
  }

  function updateHoleGeometry(): void {
    for (const state of holeStates) {
      const open = clamp01((progress - state.onset) / Math.max(state.span, 0.001));
      state.open = open;
      const transform = `translate(-50%, -50%) scale(${open})`;
      state.char.style.transform = transform;
      state.ember.style.transform = transform;
      state.char.style.opacity = String(open * config.intensity);
    }
  }

  function updateEmberFlicker(): void {
    for (const state of holeStates) {
      const wobble = config.flicker
        ? 0.84 + 0.16 * Math.sin(elapsedSeconds * 3 + state.variance * 0.035)
        : 0.84;
      state.ember.style.opacity = String(state.open * config.ember * wobble);
    }
  }

  function updateLeaks(): void {
    if (boxWidth < 0 || boxHeight < 0) return;
    const rampP = clamp01(progress * 1.6);
    for (const state of leakStates) {
      const driftX = 9 * Math.cos(elapsedSeconds * 0.35 + state.phase);
      const driftY = 8 * Math.sin(elapsedSeconds * 0.4 + state.phase);
      const flicker = 0.5 + 0.5 * Math.sin(elapsedSeconds * 0.6 + state.phase);
      const x = ((state.baseX + progress * state.sweep + driftX) / 100) * boxWidth;
      const y = ((state.baseY + driftY) / 100) * boxHeight;
      // Position goes through `transform`, not `left`/`top`: these blobs carry a blur
      // of ~9% of the short side, and only a transform moves that without relayout
      // and without re-rasterising the blur.
      state.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(
        1,
      )}px, 0) translate(-50%, -50%)`;
      state.el.style.opacity = String(config.leak * config.intensity * rampP * flicker);
    }
  }

  function applyProgress(value: number): void {
    progress = clamp01(value);
    stage.style.setProperty('--p', String(progress));
    updateHoleGeometry();
    updateEmberFlicker();
    updateLeaks();
  }

  function rebuildHoles(): void {
    if (boxWidth < 0 || boxHeight < 0) return;
    const aspect = boxWidth / Math.max(boxHeight, 1);
    const count = clamp(Math.round(config.holes), 0, MAX_HOLES);
    const holes = buildBurnHoles(config.seed, count, aspect);
    const shortSide = Math.min(boxWidth, boxHeight);

    char.replaceChildren();
    ember.replaceChildren();
    holeStates = holes.map((hole) => {
      const diameter = hole.radius * 2 * shortSide;
      const style = `left:${(hole.x * 100).toFixed(3)}%;top:${(hole.y * 100).toFixed(3)}%;width:${diameter.toFixed(1)}px;height:${diameter.toFixed(1)}px;`;

      const charEl = document.createElement('div');
      charEl.className = 'film-burn-overlay-hole film-burn-overlay-hole--char';
      charEl.style.cssText = style;
      charEl.style.filter = filter.css;
      char.appendChild(charEl);

      const emberEl = document.createElement('div');
      emberEl.className = 'film-burn-overlay-hole film-burn-overlay-hole--ember';
      emberEl.style.cssText = style;
      ember.appendChild(emberEl);

      return { char: charEl, ember: emberEl, onset: hole.onset, span: hole.span, variance: hole.variance, open: 0 };
    });

    filter.set('turbulence', { seed: config.seed });
    updateHoleGeometry();
    updateEmberFlicker();
  }

  function resizeLeaks(): void {
    const shortSide = Math.min(boxWidth, boxHeight);
    const diameter = shortSide * 0.7;
    const blurPx = shortSide * 0.09;
    for (const state of leakStates) {
      state.el.style.width = `${diameter.toFixed(1)}px`;
      state.el.style.height = `${diameter.toFixed(1)}px`;
      state.el.style.filter = `blur(${blurPx.toFixed(1)}px)`;
    }
  }

  function stepGrain(): void {
    const x = Math.floor(Math.random() * GRAIN_TILE_PX);
    const y = Math.floor(Math.random() * GRAIN_TILE_PX);
    grain.style.backgroundPosition = `${x}px ${y}px`;
  }

  function tickAnimation(_now: number, deltaMs: number): void {
    elapsedSeconds += deltaMs / 1000;
    timeWriteMs += deltaMs;
    if (timeWriteMs >= TIME_STEP_MS) {
      timeWriteMs %= TIME_STEP_MS;
      updateEmberFlicker();
      updateLeaks();
    }

    if (config.grain > 0) {
      grainElapsedMs += deltaMs;
      if (grainElapsedMs >= GRAIN_STEP_MS) {
        grainElapsedMs %= GRAIN_STEP_MS;
        stepGrain();
      }
    }
  }

  function syncActivity(): void {
    const wanted = !reduced && visible && (config.leak > 0 || config.flicker || config.grain > 0);
    if (wanted && stopTick === null) stopTick = onTick(tickAnimation);
    else if (!wanted && stopTick !== null) {
      stopTick();
      stopTick = null;
    }
  }

  function syncScroll(): void {
    stopScroll?.();
    stopScroll =
      config.scroll === false ? null : onScrollProgress(host, applyProgress, config.scroll);
  }

  applyOptionVars();
  syncScroll();
  syncActivity();

  const stopResize = onResize(host, (width, height) => {
    const nextWidth = Math.round(width);
    const nextHeight = Math.round(height);
    if (nextWidth === boxWidth && nextHeight === boxHeight) return;
    boxWidth = nextWidth;
    boxHeight = nextHeight;
    rebuildHoles();
    resizeLeaks();
    updateLeaks();
  });

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncActivity();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    if (reduced) {
      elapsedSeconds = 0;
      updateEmberFlicker();
      updateLeaks();
    }
    syncActivity();
  });

  return {
    setOptions(patch: Partial<FilmBurnOverlayOptions>): void {
      if (destroyed) return;
      const holesOrSeedChanged =
        (patch.holes !== undefined && patch.holes !== config.holes) ||
        (patch.seed !== undefined && patch.seed !== config.seed);
      const srcChanged = patch.src !== undefined && patch.src !== config.src;

      config = resolve(config, patch);
      applyOptionVars();

      if (srcChanged) {
        if (sourceImg !== null) {
          sourceImg.style.visibility = sourceImgVisibility;
          sourceImg = null;
        }
        image.src = config.src as string;
      }
      if (holesOrSeedChanged) rebuildHoles();
      else {
        updateHoleGeometry();
        updateEmberFlicker();
      }
      updateLeaks();
      if (patch.scroll !== undefined) syncScroll();
      if (patch.progress !== undefined && config.scroll === false) applyProgress(config.progress);
      syncActivity();
    },

    setProgress(value: number): void {
      if (destroyed) return;
      applyProgress(value);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopScroll?.();
      stopScroll = null;
      stopResize();
      stopVisible();
      stopMotion();
      filter.destroy();
      stage.remove();
      if (sourceImg !== null) sourceImg.style.visibility = sourceImgVisibility;
    },
  };
}

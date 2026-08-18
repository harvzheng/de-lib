/**
 * Filmstock Video Background — any live video run as Kodak Gold 200 through a
 * projector: a decimated frame hold, independent dye-layer curves, amber
 * halation, heavy moving grain, gate weave, print wear and projector flutter.
 *
 * This file is the shell. It owns the options, the video element, the held-frame
 * clock and the visibility and reduced-motion gating; the renderers own nothing
 * but pixels. Both are handed the same clamped config and the same per-held-frame
 * `FrameState`, so the only branch on renderer here is construction.
 */

import { loadVideo, onResize, onVisible } from '../../core/dom';
import { clamp, clamp01 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { createFrameState, updateFrameState } from './frame';
import { createCssFilmstockRenderer } from './renderer-css';
import { createWebglFilmstockRenderer } from './renderer-webgl';
import type { Effect } from '../../core/types';
import type { FrameState } from './frame';
import type { FilmstockLook } from './grade';

export type { FilmstockLook } from './grade';

export type FilmstockRenderer = 'auto' | 'webgl' | 'css';
export type FlickerStyle = 'exposure' | 'projector' | 'mixed';

export interface FilmGrainVideoOptions {
  /** Video URL, or a `<video>` you already have. Any video works — this is the point. */
  src: string | HTMLVideoElement;
  /** Poster shown until the first frame decodes. */
  poster?: string;
  /** 'auto' prefers WebGL, falls back to Canvas/SVG when WebGL2 is unavailable. Default 'auto'. */
  renderer?: FilmstockRenderer;
  /** Frame-hold rate; the picture only updates this many times a second. Default 16. */
  fps?: number;
  /** `video.playbackRate`. Below 1 exaggerates the judder. Default 1. */
  speed?: number;
  /** Grain strength, 0..2. Default 0.85. */
  grain?: number;
  /** Grain size in px. Default 1.6. */
  grainSize?: number;
  /** Amber highlight bleed, 0..1. Default 0.5. */
  halation?: number;
  /** Gate weave amount, 0..1. Default 0.4. */
  gateWeave?: number;
  /** Vignette strength, 0..1. Default 0.45. */
  vignette?: number;
  /** Exposure flicker per held frame, 0..1. Default 0.2. */
  flicker?: number;
  /** What kind of flicker to apply. Default 'exposure' — the current behaviour. */
  flickerStyle?: FlickerStyle;
  /** Events per second for projector artefacts. Default 1.2. */
  flickerRate?: number;
  /** Rare full-frame exposure flashes, 0..1. Default 0.35. */
  flash?: number;
  /** Soft rolling shutter band travelling vertically, 0..1. Default 0.3. */
  shutterBand?: number;
  /** Warm/cool dye instability, independent of brightness, 0..1. Default 0.25. */
  colorBreathing?: number;
  /** Dust and scratch density, 0..1. Default 0.3. */
  dust?: number;
  /** 'kodak-gold-200' or 'neutral'. Default 'kodak-gold-200'. */
  look?: FilmstockLook;
  /** Pause playback and rendering while scrolled out of view. Default true. */
  pauseOffscreen?: boolean;
}

export interface FilmGrainVideoHandle extends Effect<FilmGrainVideoOptions> {
  /** Swaps the source without rebuilding the effect. */
  setSource(src: string | HTMLVideoElement): Promise<void>;
  readonly video: HTMLVideoElement;
  /** Which renderer actually took the job. */
  readonly activeRenderer: 'webgl' | 'css';
}

/** Options resolved and clamped: what the frame state and both renderers read. */
export interface FilmstockConfig {
  poster: string | undefined;
  renderer: FilmstockRenderer;
  fps: number;
  speed: number;
  grain: number;
  grainSize: number;
  halation: number;
  gateWeave: number;
  vignette: number;
  flicker: number;
  flickerStyle: FlickerStyle;
  flickerRate: number;
  flash: number;
  shutterBand: number;
  colorBreathing: number;
  dust: number;
  look: FilmstockLook;
  pauseOffscreen: boolean;
}

/** The contract both renderers implement. One held frame is the only per-frame path. */
export interface FilmstockRendererInstance {
  /** Paints one held frame of `video` under `state`. */
  paint(video: HTMLVideoElement, state: FrameState): void;
  /** Drops the held frame, uncovering the poster while a new source decodes. */
  clear(): void;
  setOptions(config: FilmstockConfig): void;
  resize(width: number, height: number, pixelRatio: number): void;
  destroy(): void;
}

type ResolvedOptions = FilmstockConfig & { src: string | HTMLVideoElement };

const DEFAULTS: FilmstockConfig = {
  poster: undefined,
  renderer: 'auto',
  fps: 16,
  speed: 1,
  grain: 0.85,
  grainSize: 1.6,
  halation: 0.5,
  gateWeave: 0.4,
  vignette: 0.45,
  flicker: 0.2,
  flickerStyle: 'exposure',
  flickerRate: 1.2,
  flash: 0.35,
  shutterBand: 0.3,
  colorBreathing: 0.25,
  dust: 0.3,
  look: 'kodak-gold-200',
  pauseOffscreen: true,
};

/**
 * Merges a patch and clamps every number to its documented working range, here
 * rather than in the renderers: two renderers reading one already-valid config
 * cannot disagree about what an out-of-range option meant.
 */
function resolve(base: ResolvedOptions, patch: FilmGrainVideoOptions): ResolvedOptions {
  return {
    src: patch.src ?? base.src,
    poster: patch.poster ?? base.poster,
    renderer: patch.renderer ?? base.renderer,
    fps: clamp(patch.fps ?? base.fps, 1, 60),
    speed: clamp(patch.speed ?? base.speed, 0.0625, 16),
    grain: clamp(patch.grain ?? base.grain, 0, 2),
    grainSize: clamp(patch.grainSize ?? base.grainSize, 0.4, 8),
    halation: clamp01(patch.halation ?? base.halation),
    gateWeave: clamp01(patch.gateWeave ?? base.gateWeave),
    vignette: clamp01(patch.vignette ?? base.vignette),
    flicker: clamp01(patch.flicker ?? base.flicker),
    flickerStyle: patch.flickerStyle ?? base.flickerStyle,
    flickerRate: clamp(patch.flickerRate ?? base.flickerRate, 0, 60),
    flash: clamp01(patch.flash ?? base.flash),
    shutterBand: clamp01(patch.shutterBand ?? base.shutterBand),
    colorBreathing: clamp01(patch.colorBreathing ?? base.colorBreathing),
    dust: clamp01(patch.dust ?? base.dust),
    look: patch.look ?? base.look,
    pauseOffscreen: patch.pauseOffscreen ?? base.pauseOffscreen,
  };
}

function awaitVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('error', failed);
    };
    const ready = (): void => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      cleanup();
      resolve();
    };
    const failed = (): void => {
      cleanup();
      reject(new Error(`Failed to load video: ${video.currentSrc || video.src || 'HTMLVideoElement'}`));
    };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('error', failed);
  });
}

function configureVideo(video: HTMLVideoElement, speed: number): void {
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.loop = true;
  video.playbackRate = speed;
}

function releaseVideo(video: HTMLVideoElement, owned: boolean): void {
  video.pause();
  if (!owned) return;
  video.removeAttribute('src');
  video.load();
}

export function createFilmGrainVideo(
  host: HTMLElement,
  options: FilmGrainVideoOptions,
): FilmGrainVideoHandle {
  // Through `resolve`, not a spread: an explicitly undefined option must fall
  // back to its default here exactly as it does in `setOptions`.
  let config: ResolvedOptions = resolve({ ...DEFAULTS, src: options.src }, options);
  const hostAlreadyMarked = host.classList.contains('filmstock-host');
  host.classList.add('filmstock-host');

  const state = createFrameState();
  let currentVideo = document.createElement('video');
  let ownsVideo = true;
  let ready = false;
  let visible = false;
  let reduced = prefersReducedMotion();
  let boxWidth = 0;
  let boxHeight = 0;
  let pixelRatio = 1;
  let heldFrame = 0;
  let nextFrameAt = 0;
  let sourceToken = 0;
  let stopTick: (() => void) | null = null;
  let destroyed = false;

  function build(): { instance: FilmstockRendererInstance; kind: 'webgl' | 'css' } {
    if (config.renderer !== 'css') {
      const webgl = createWebglFilmstockRenderer(host, config);
      if (webgl !== null) return { instance: webgl, kind: 'webgl' };
      console.warn(
        'film-grain-video: WebGL2 is unavailable, rendering through the Canvas/SVG renderer.',
      );
    }
    return { instance: createCssFilmstockRenderer(host, config), kind: 'css' };
  }

  let current = build();

  function paintHeldFrame(frame: number): void {
    if (!ready || boxWidth <= 0 || boxHeight <= 0) return;
    updateFrameState(state, frame, config, boxWidth, boxHeight, reduced);
    current.instance.paint(currentVideo, state);
  }

  function tick(now: number): void {
    if (now < nextFrameAt) return;
    // Not accumulated: a held frame that arrives late must not queue a catch-up
    // burst, because the judder is the point.
    nextFrameAt = now + 1000 / config.fps;
    heldFrame += 1;
    paintHeldFrame(heldFrame);
  }

  function shouldPlay(): boolean {
    return ready && !reduced && (!config.pauseOffscreen || visible);
  }

  function syncPlayback(): void {
    configureVideo(currentVideo, config.speed);
    if (!shouldPlay()) {
      currentVideo.pause();
      return;
    }
    if (!currentVideo.paused) return;
    currentVideo.play().catch((error: unknown) => {
      console.warn('Film Grain Video could not autoplay; the current frame will remain static.', error);
    });
  }

  function syncActivity(): void {
    const wanted = shouldPlay();
    if (wanted && stopTick === null) {
      nextFrameAt = 0;
      stopTick = onTick(tick);
    } else if (!wanted && stopTick !== null) {
      stopTick();
      stopTick = null;
    }
    syncPlayback();
  }

  async function adoptSource(source: string | HTMLVideoElement): Promise<void> {
    const token = ++sourceToken;
    ready = false;
    stopTick?.();
    stopTick = null;
    releaseVideo(currentVideo, ownsVideo);
    current.instance.clear();

    const owned = typeof source === 'string';
    if (owned) {
      currentVideo = document.createElement('video');
      ownsVideo = true;
    } else {
      currentVideo = source;
      ownsVideo = false;
      configureVideo(currentVideo, config.speed);
    }
    current.instance.setOptions(config);

    const nextVideo = owned
      ? await loadVideo(source, { poster: config.poster, loop: true })
      : currentVideo;
    if (!owned) await awaitVideoFrame(nextVideo);

    if (destroyed || token !== sourceToken) {
      if (owned) releaseVideo(nextVideo, true);
      return;
    }

    currentVideo = nextVideo;
    ownsVideo = owned;
    configureVideo(currentVideo, config.speed);
    ready = true;
    heldFrame = 0;
    paintHeldFrame(0);
    syncActivity();
  }

  const stopResize = onResize(host, (width, height) => {
    const nextWidth = Math.round(width);
    const nextHeight = Math.round(height);
    const nextRatio = clamp(window.devicePixelRatio || 1, 1, 2);
    if (nextWidth === boxWidth && nextHeight === boxHeight && nextRatio === pixelRatio) return;
    boxWidth = nextWidth;
    boxHeight = nextHeight;
    pixelRatio = nextRatio;
    current.instance.resize(boxWidth, boxHeight, pixelRatio);
    paintHeldFrame(reduced ? 0 : heldFrame);
  });

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncActivity();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    nextFrameAt = 0;
    paintHeldFrame(reduced ? 0 : heldFrame);
    syncActivity();
  });

  void adoptSource(config.src);

  return {
    get video(): HTMLVideoElement {
      return currentVideo;
    },

    get activeRenderer(): 'webgl' | 'css' {
      return current.kind;
    },

    setOptions(patch: Partial<FilmGrainVideoOptions>): void {
      if (destroyed) return;
      const previous = config;
      config = resolve(config, patch as FilmGrainVideoOptions);

      if (config.renderer !== previous.renderer) {
        current.instance.destroy();
        current = build();
        current.instance.resize(boxWidth, boxHeight, pixelRatio);
      }
      current.instance.setOptions(config);
      nextFrameAt = 0;

      if (config.src !== previous.src) {
        void adoptSource(config.src);
        return;
      }
      paintHeldFrame(reduced ? 0 : heldFrame);
      syncActivity();
    },

    async setSource(source: string | HTMLVideoElement): Promise<void> {
      if (destroyed) return;
      config = resolve(config, { src: source });
      await adoptSource(source);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      sourceToken += 1;
      stopTick?.();
      stopTick = null;
      stopResize();
      stopVisible();
      stopMotion();
      releaseVideo(currentVideo, ownsVideo);
      current.instance.destroy();
      if (!hostAlreadyMarked) host.classList.remove('filmstock-host');
    },
  };
}

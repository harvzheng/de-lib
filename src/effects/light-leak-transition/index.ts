/**
 * Light Leak Transition — a warm film fog crosses the frame and carries the cut
 * inside it: the leak swells, the outgoing shot lifts and desaturates toward
 * white, its highlights bleed amber, and the incoming shot is already there when
 * the flare recedes.
 *
 * Two renderers. WebGL evaluates the leak's gradients, blend stack, halation
 * bleed and grain per pixel in a single pass; the CSS/SVG renderer stacks
 * blurred gradient layers with blend modes and drives two SVG filters over live
 * DOM. Both implement `LeakRendererInstance`, so this file branches on renderer
 * exactly once — at construction.
 */

import { loadImage, loadVideo, onResize } from '../../core/dom';
import { clamp01 } from '../../core/math';
import { onScrollProgress } from '../../core/scroll';
import { resolveLeakDirection } from './leaks';
import { createCssLeakRenderer } from './renderer-css';
import { createWebglLeakRenderer } from './renderer-webgl';
import type { CardinalLeakDirection } from './leaks';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { Effect } from '../../core/types';

export type LeakRenderer = 'auto' | 'webgl' | 'css';
export type LeakStyle = 'flash' | 'sweep';
export type LeakDirection = 'left' | 'right' | 'top' | 'bottom' | 'random';
export type LeakMedia = HTMLImageElement | HTMLVideoElement;

export interface LightLeakTransitionOptions {
  /** Outgoing media. A URL, or an element you already have on the page. */
  from: string | LeakMedia;
  /** Incoming media, revealed through the leak. */
  to: string | LeakMedia;
  /** 'auto' prefers WebGL, falls back to CSS when WebGL2 is unavailable. Default 'auto'. */
  renderer?: LeakRenderer;
  /** Default 'flash'. */
  style?: LeakStyle;
  /** Edge the leak enters from. Default 'left'. */
  direction?: LeakDirection;
  /** Scroll mapping. Default the pinned scrub `{ start: 0, end: 1 }`. Pass false to drive it yourself. */
  scroll?: ScrollProgressOptions | false;
  /** Starting progress when `scroll` is false. Default 0. */
  progress?: number;
  /** Overall leak strength, 0..1. Default 0.85. */
  intensity?: number;
  /** How blown out the peak gets, 0..1. At 1 the frame goes to white. Default 0.7. */
  bloom?: number;
  /** Warmth of the leak: 0 is deep red, 1 is pale amber. Default 0.5. */
  warmth?: number;
  /** Softness of the leak edges in px. Default 80. */
  softness?: number;
  /** Organic wobble on the leak edge, 0..1. Default 0.4. */
  organic?: number;
  /** Halation-style bleed picked up from the outgoing shot's highlights, 0..1. Default 0.45. */
  halation?: number;
  /** Film grain over the composite, 0..1. Default 0.3. */
  grain?: number;
  /** PRNG seed; same seed, same leak. Default 1. */
  seed?: number;
}

export interface LightLeakTransitionHandle extends Effect<LightLeakTransitionOptions> {
  /** Drives the transition manually, 0..1. Only meaningful when `scroll` is false. */
  setProgress(progress: number): void;
  /** Which renderer actually took the job. */
  readonly activeRenderer: 'webgl' | 'css';
}

/** What both renderers are handed: options resolved, media already decoded. */
export interface LeakConfig {
  from: LeakMedia | null;
  to: LeakMedia | null;
  style: LeakStyle;
  /** Already resolved against the seed, so both renderers place the leak alike. */
  direction: CardinalLeakDirection;
  intensity: number;
  bloom: number;
  warmth: number;
  softness: number;
  organic: number;
  halation: number;
  grain: number;
  seed: number;
}

/** The contract both renderers implement. Progress is the only per-frame path. */
export interface LeakRendererInstance {
  setProgress(progress: number): void;
  setOptions(config: LeakConfig): void;
  resize(): void;
  destroy(): void;
}

type ResolvedOptions = Required<LightLeakTransitionOptions>;

const DEFAULTS = {
  renderer: 'auto',
  style: 'flash',
  direction: 'left',
  scroll: { start: 0, end: 1 },
  progress: 0,
  intensity: 0.85,
  bloom: 0.7,
  warmth: 0.5,
  softness: 80,
  organic: 0.4,
  halation: 0.45,
  grain: 0.3,
  seed: 1,
} satisfies Omit<ResolvedOptions, 'from' | 'to'>;

const VIDEO_SOURCE = /\.(mp4|webm|ogv|mov)(?:[?#]|$)/i;

function resolveOptions(
  base: ResolvedOptions,
  patch: Partial<LightLeakTransitionOptions>,
): ResolvedOptions {
  const next: ResolvedOptions = { ...base };
  for (const key in patch) {
    const value = patch[key as keyof LightLeakTransitionOptions];
    // An explicit undefined means "leave this alone", not "reset to default".
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  return next;
}

/**
 * URLs are loaded; elements are taken as they are, but not before they can
 * report their pixel dimensions — cover-fit is wrong without them.
 */
function resolveMedia(source: string | LeakMedia): Promise<LeakMedia> {
  if (typeof source === 'string') {
    return VIDEO_SOURCE.test(source) ? loadVideo(source) : loadImage(source);
  }
  if (source instanceof HTMLVideoElement) {
    if (source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve(source);
    const { promise, resolve } = Promise.withResolvers<LeakMedia>();
    source.addEventListener('loadeddata', () => resolve(source), { once: true });
    return promise;
  }
  return source.complete ? Promise.resolve(source) : source.decode().then(() => source);
}

export function createLightLeakTransition(
  host: HTMLElement,
  options: LightLeakTransitionOptions,
): LightLeakTransitionHandle {
  let config = resolveOptions({ ...DEFAULTS, from: options.from, to: options.to }, options);
  let fromMedia: LeakMedia | null = null;
  let toMedia: LeakMedia | null = null;
  let progress = clamp01(config.progress);
  let loadToken = 0;
  let destroyed = false;
  let stopScroll: (() => void) | null = null;

  function leakConfig(): LeakConfig {
    return {
      from: fromMedia,
      to: toMedia,
      style: config.style,
      direction: resolveLeakDirection(config.direction, config.seed),
      intensity: config.intensity,
      bloom: config.bloom,
      warmth: config.warmth,
      softness: config.softness,
      organic: config.organic,
      halation: config.halation,
      grain: config.grain,
      seed: config.seed,
    };
  }

  function build(): { instance: LeakRendererInstance; kind: 'webgl' | 'css' } {
    if (config.renderer !== 'css') {
      const webgl = createWebglLeakRenderer(host, leakConfig());
      if (webgl !== null) return { instance: webgl, kind: 'webgl' };
      console.warn(
        'light-leak-transition: WebGL2 is unavailable, rendering through the CSS/SVG renderer.',
      );
    }
    return { instance: createCssLeakRenderer(host, leakConfig()), kind: 'css' };
  }

  let current = build();

  function push(): void {
    current.instance.setOptions(leakConfig());
    current.instance.resize();
    current.instance.setProgress(progress);
  }

  function syncMedia(): void {
    const token = (loadToken += 1);
    void Promise.all([resolveMedia(config.from), resolveMedia(config.to)])
      .then(([from, to]) => {
        // A later from/to, or a destroy, landed while these were decoding.
        if (destroyed || token !== loadToken) return;
        fromMedia = from;
        toMedia = to;
        push();
      })
      .catch((error: unknown) => {
        console.error('light-leak-transition: media failed to load.', error);
      });
  }

  function syncScroll(): void {
    stopScroll?.();
    stopScroll = null;
    if (config.scroll === false) return;
    stopScroll = onScrollProgress(
      host,
      (value) => {
        progress = value;
        current.instance.setProgress(value);
      },
      config.scroll,
    );
  }

  const stopResize = onResize(host, () => current.instance.resize());

  syncMedia();
  syncScroll();

  return {
    get activeRenderer(): 'webgl' | 'css' {
      return current.kind;
    },

    setOptions(patch: Partial<LightLeakTransitionOptions>): void {
      if (destroyed) return;
      const previous = config;
      config = resolveOptions(config, patch);

      if (config.renderer !== previous.renderer) {
        current.instance.destroy();
        current = build();
      }
      if (config.from !== previous.from || config.to !== previous.to) {
        fromMedia = null;
        toMedia = null;
        syncMedia();
      }
      if (config.scroll !== previous.scroll) syncScroll();
      if (config.scroll === false && patch.progress !== undefined) {
        progress = clamp01(config.progress);
      }
      push();
    },

    setProgress(value: number): void {
      if (destroyed) return;
      progress = clamp01(value);
      current.instance.setProgress(progress);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      loadToken += 1;
      stopScroll?.();
      stopScroll = null;
      stopResize();
      current.instance.destroy();
    },
  };
}

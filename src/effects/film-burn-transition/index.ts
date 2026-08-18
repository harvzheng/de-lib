/**
 * Film Burn Transition — the outgoing shot burns away to reveal the incoming
 * one: holes open where a noise field first crosses the burn threshold, each
 * rim runs white-hot through amber into scorched brown, and the paper ahead of
 * the edge darkens and blows out before it goes.
 *
 * The one effect in the pack with two renderers. WebGL generates the burn field
 * per pixel; the CSS/SVG renderer thresholds a live `feTurbulence` through
 * `feComponentTransfer` and punches holes with `feComposite`. Both implement
 * `BurnRendererInstance`, so this file branches on renderer exactly once.
 */

import { loadImage, loadVideo, onResize } from '../../core/dom';
import { clamp01 } from '../../core/math';
import { onScrollProgress } from '../../core/scroll';
import { createCssBurnRenderer } from './renderer-css';
import { createWebglBurnRenderer } from './renderer-webgl';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { Effect } from '../../core/types';

export type BurnRenderer = 'auto' | 'webgl' | 'css';
export type BurnOrigin = 'center' | 'left' | 'right' | 'top' | 'bottom' | 'none';
export type BurnMedia = HTMLImageElement | HTMLVideoElement;

export interface FilmBurnTransitionOptions {
  /** Outgoing media. A URL, or an element you already have on the page. */
  from: string | HTMLImageElement | HTMLVideoElement;
  /** Incoming media, revealed through the burn. */
  to: string | HTMLImageElement | HTMLVideoElement;
  /** 'auto' prefers WebGL, falls back to CSS when WebGL2 is unavailable. Default 'auto'. */
  renderer?: BurnRenderer;
  /** Scroll mapping. Default the pinned scrub `{ start: 0, end: 1 }`. Pass false to drive it yourself. */
  scroll?: ScrollProgressOptions | false;
  /** Starting progress when `scroll` is false. Default 0. */
  progress?: number;
  /** Ignition colour at the burn edge. Default '#ff7a1a'. */
  burnColor?: string;
  /** Charred paper colour just behind the edge. Default '#2a1206'. */
  charColor?: string;
  /** Thickness of the glowing rim, 0..1 of the frame. Default 0.06. */
  edge?: number;
  /** Burn-hole cell size — lower is bigger, blotchier holes. Default 3. */
  scale?: number;
  /** Where the burn starts. Default 'center'. */
  origin?: BurnOrigin;
  /** Film grain over the composite, 0..1. Default 0.35. */
  grain?: number;
  /** PRNG seed; same seed, same burn. Default 1. */
  seed?: number;
}

export interface FilmBurnTransitionHandle extends Effect<FilmBurnTransitionOptions> {
  /** Drives the burn manually, 0..1. Only meaningful when `scroll` is false. */
  setProgress(progress: number): void;
  /** Which renderer actually took the job. */
  readonly activeRenderer: 'webgl' | 'css';
}

/** What both renderers are handed: options resolved, media already decoded. */
export interface BurnConfig {
  from: BurnMedia | null;
  to: BurnMedia | null;
  burnColor: string;
  charColor: string;
  edge: number;
  scale: number;
  origin: BurnOrigin;
  grain: number;
  seed: number;
}

/** The contract both renderers implement. Progress is the only per-frame path. */
export interface BurnRendererInstance {
  setProgress(progress: number): void;
  setOptions(config: BurnConfig): void;
  resize(): void;
  destroy(): void;
}

type ResolvedOptions = Required<FilmBurnTransitionOptions>;

const DEFAULTS = {
  renderer: 'auto',
  scroll: { start: 0, end: 1 },
  progress: 0,
  burnColor: '#ff7a1a',
  charColor: '#2a1206',
  edge: 0.06,
  scale: 3,
  origin: 'center',
  grain: 0.35,
  seed: 1,
} satisfies Omit<ResolvedOptions, 'from' | 'to'>;

const VIDEO_SOURCE = /\.(mp4|webm|ogv|mov)(?:[?#]|$)/i;

function resolveOptions(
  base: ResolvedOptions,
  patch: Partial<FilmBurnTransitionOptions>,
): ResolvedOptions {
  const next: ResolvedOptions = { ...base };
  for (const key in patch) {
    const value = patch[key as keyof FilmBurnTransitionOptions];
    // An explicit undefined means "leave this alone", not "reset to default".
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  return next;
}

/**
 * URLs are loaded; elements are taken as they are, but not before they can
 * report their pixel dimensions — cover-fit is wrong without them.
 */
function resolveMedia(source: string | BurnMedia): Promise<BurnMedia> {
  if (typeof source === 'string') {
    return VIDEO_SOURCE.test(source) ? loadVideo(source) : loadImage(source);
  }
  if (source instanceof HTMLVideoElement) {
    if (source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve(source);
    const { promise, resolve } = Promise.withResolvers<BurnMedia>();
    source.addEventListener('loadeddata', () => resolve(source), { once: true });
    return promise;
  }
  return source.complete ? Promise.resolve(source) : source.decode().then(() => source);
}

export function createFilmBurnTransition(
  host: HTMLElement,
  options: FilmBurnTransitionOptions,
): FilmBurnTransitionHandle {
  let config = resolveOptions({ ...DEFAULTS, from: options.from, to: options.to }, options);
  let fromMedia: BurnMedia | null = null;
  let toMedia: BurnMedia | null = null;
  let progress = clamp01(config.progress);
  let loadToken = 0;
  let destroyed = false;
  let stopScroll: (() => void) | null = null;

  function burnConfig(): BurnConfig {
    return {
      from: fromMedia,
      to: toMedia,
      burnColor: config.burnColor,
      charColor: config.charColor,
      edge: config.edge,
      scale: config.scale,
      origin: config.origin,
      grain: config.grain,
      seed: config.seed,
    };
  }

  function build(): { instance: BurnRendererInstance; kind: 'webgl' | 'css' } {
    if (config.renderer !== 'css') {
      const webgl = createWebglBurnRenderer(host, burnConfig());
      if (webgl !== null) return { instance: webgl, kind: 'webgl' };
      console.warn(
        'film-burn-transition: WebGL2 is unavailable, rendering through the CSS/SVG renderer.',
      );
    }
    return { instance: createCssBurnRenderer(host, burnConfig()), kind: 'css' };
  }

  let current = build();

  function push(): void {
    current.instance.setOptions(burnConfig());
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
        console.error('film-burn-transition: media failed to load.', error);
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

    setOptions(patch: Partial<FilmBurnTransitionOptions>): void {
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

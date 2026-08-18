import { loadImage, loadVideo, onResize } from '../../core/dom';
import { clamp01 } from '../../core/math';
import { onScrollProgress } from '../../core/scroll';
import { createCssDissolveRenderer } from './renderer-css';
import { createWebglDissolveRenderer } from './renderer-webgl';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { Effect } from '../../core/types';

export type DissolveRenderer = 'auto' | 'webgl' | 'css';
export type DissolveDirection = 'left' | 'right' | 'up' | 'down' | 'random';
export type DissolveMedia = HTMLImageElement | HTMLVideoElement;

export interface ParticulateDissolveOptions {
  /** Optional media to dissolve. Omit to dissolve the host's existing content — the
   *  CSS renderer works over arbitrary live DOM; the WebGL renderer requires media. */
  src?: string | HTMLImageElement | HTMLVideoElement;
  /** 'auto' prefers WebGL when `src` is media and WebGL2 is available, else CSS. Default 'auto'. */
  renderer?: DissolveRenderer;
  /** Scroll mapping. Default `{ start: 0.9, end: 0.35 }`. Pass false to drive it yourself. */
  scroll?: ScrollProgressOptions | false;
  /** Starting progress when `scroll` is false. Default 0. */
  progress?: number;
  /** Where the ash drifts. Default 'up'. */
  direction?: DissolveDirection;
  /** How far ash travels before fading, as a fraction of the target's size. Default 0.45. */
  drift?: number;
  /** Size of the breakup cells in px — smaller is finer ash. Default 6. */
  grain?: number;
  /** How much the dissolve edge leads the drift, 0..1. Higher reads as crumbling, lower as fading. Default 0.6. */
  edge?: number;
  /** Loose fleck count for the CSS renderer's canvas layer. Capped internally. Default 900. */
  flecks?: number;
  /** Ash tint. Default inherits from the source; pass a CSS colour to force it. */
  color?: string;
  /** Turbulence in the drift path, 0..1. Default 0.35. */
  turbulence?: number;
  /** PRNG seed; same seed, same disintegration. Default 1. */
  seed?: number;
}

export interface ParticulateDissolveHandle extends Effect<ParticulateDissolveOptions> {
  /** Drives the dissolve manually, 0..1. Only meaningful when `scroll` is false. */
  setProgress(progress: number): void;
  /** Which renderer actually took the job. */
  readonly activeRenderer: 'webgl' | 'css';
}

export interface DissolveConfig {
  media: DissolveMedia | null;
  mediaRequested: boolean;
  direction: DissolveDirection;
  drift: number;
  grain: number;
  edge: number;
  flecks: number;
  color: string | undefined;
  turbulence: number;
  seed: number;
}

export interface DissolveRendererInstance {
  setProgress(progress: number): void;
  setOptions(config: DissolveConfig): void;
  resize(): void;
  destroy(): void;
}

type ResolvedOptions = Omit<Required<ParticulateDissolveOptions>, 'src' | 'color'> & {
  src?: string | DissolveMedia;
  color?: string;
};

const DEFAULTS = {
  renderer: 'auto',
  scroll: { start: 0.9, end: 0.35 },
  progress: 0,
  direction: 'up',
  drift: 0.45,
  grain: 6,
  edge: 0.6,
  flecks: 900,
  turbulence: 0.35,
  seed: 1,
} satisfies Omit<ResolvedOptions, 'src' | 'color'>;

const VIDEO_SOURCE = /\.(mp4|webm|ogv|mov)(?:[?#]|$)/i;

function resolveOptions(
  base: ResolvedOptions,
  patch: Partial<ParticulateDissolveOptions>,
): ResolvedOptions {
  const next: ResolvedOptions = { ...base };
  for (const key in patch) {
    const value = patch[key as keyof ParticulateDissolveOptions];
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  return next;
}

function resolveMedia(source: string | DissolveMedia): Promise<DissolveMedia> {
  if (typeof source === 'string') {
    return VIDEO_SOURCE.test(source) ? loadVideo(source) : loadImage(source);
  }
  if (source instanceof HTMLVideoElement) {
    if (source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve(source);
    const { promise, resolve } = Promise.withResolvers<DissolveMedia>();
    source.addEventListener('loadeddata', () => resolve(source), { once: true });
    return promise;
  }
  return source.complete ? Promise.resolve(source) : source.decode().then(() => source);
}

export function createParticulateDissolve(
  host: HTMLElement,
  options: ParticulateDissolveOptions = {},
): ParticulateDissolveHandle {
  let config = resolveOptions({ ...DEFAULTS }, options);
  let media: DissolveMedia | null = null;
  let progress = clamp01(config.progress);
  let loadToken = 0;
  let destroyed = false;
  let stopScroll: (() => void) | null = null;

  function rendererConfig(): DissolveConfig {
    return {
      media,
      mediaRequested: config.src !== undefined,
      direction: config.direction,
      drift: config.drift,
      grain: config.grain,
      edge: config.edge,
      flecks: config.flecks,
      color: config.color,
      turbulence: config.turbulence,
      seed: config.seed,
    };
  }

  function build(): { instance: DissolveRendererInstance; kind: 'webgl' | 'css' } {
    if (config.renderer !== 'css' && config.src !== undefined) {
      const webgl = createWebglDissolveRenderer(host, rendererConfig());
      if (webgl !== null) return { instance: webgl, kind: 'webgl' };
      console.warn(
        'particulate-dissolve: WebGL2 is unavailable, rendering through the CSS/SVG renderer.',
      );
    } else if (config.renderer === 'webgl') {
      console.warn(
        'particulate-dissolve: the WebGL renderer requires media; rendering the live DOM through CSS/SVG.',
      );
    }
    return { instance: createCssDissolveRenderer(host, rendererConfig()), kind: 'css' };
  }

  let current = build();

  function push(): void {
    current.instance.setOptions(rendererConfig());
    current.instance.resize();
    current.instance.setProgress(progress);
  }

  function syncMedia(): void {
    const token = (loadToken += 1);
    if (config.src === undefined) {
      media = null;
      push();
      return;
    }
    void resolveMedia(config.src)
      .then((resolved) => {
        if (destroyed || token !== loadToken) return;
        media = resolved;
        push();
      })
      .catch((error: unknown) => {
        console.error('particulate-dissolve: media failed to load.', error);
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

    setOptions(patch: Partial<ParticulateDissolveOptions>): void {
      if (destroyed) return;
      const previous = config;
      config = resolveOptions(config, patch);
      const sourceChanged = config.src !== previous.src;
      const mediaModeChanged = (previous.src === undefined) !== (config.src === undefined);
      if (sourceChanged) media = null;

      if (config.renderer !== previous.renderer || mediaModeChanged) {
        current.instance.destroy();
        current = build();
      }
      if (sourceChanged) syncMedia();
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

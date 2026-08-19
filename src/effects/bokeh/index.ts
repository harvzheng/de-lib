/**
 * Bokeh — defocused highlights in front of whatever is already on the page.
 *
 * Placement is content-derived, which is the whole point: the effect rasterises
 * the host's image or video once into a 96px-wide scratch canvas, finds the
 * bright locally-isolated points in it (`highlights.ts`), and puts one disc on
 * each, carrying that point's colour and brightness. A lamp in the picture
 * becomes a lamp-shaped bokeh, a dim reflection becomes a dim disc, and the
 * field belongs to the frame instead of sitting on top of it. With no readable
 * source — no media, a cross-origin image, `source: 'none'` — it falls back to a
 * seeded free field, which is the old behaviour and still looks like bokeh.
 *
 * There is exactly one readback, on source change and on resize. Nothing in the
 * per-frame path touches pixels.
 *
 * Two renderers over one shared disc list, so both agree on layout: the CSS one
 * paints each disc as a radial gradient and writes only transform and opacity;
 * the WebGL one uploads the same list as uniforms and adds polygonal aperture
 * blades, a chromatically fringed rim, and highlight roll-off.
 */

import { onResize } from '../../core/dom';
import { clamp01 } from '../../core/math';
import { onScrollProgress } from '../../core/scroll';
import { createDiscs } from './discs';
import { findHighlights } from './highlights';
import { createCssBokehRenderer } from './renderer-css';
import { createWebglBokehRenderer } from './renderer-webgl';
import type { BokehDisc } from './discs';
import type { Highlight } from './highlights';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { Effect } from '../../core/types';

export type BokehRenderer = 'auto' | 'webgl' | 'css';
/** 'auto' finds the first image or video inside the host; 'none' skips detection. */
export type BokehSource = 'auto' | 'none' | string | HTMLImageElement | HTMLVideoElement;

export interface BokehOptions {
  /** 'auto' prefers WebGL, falls back to CSS when WebGL2 is unavailable. Default 'auto'. */
  renderer?: BokehRenderer;
  /** What to read highlights from. Default 'auto'. */
  source?: BokehSource;
  /** How strongly discs snap onto detected highlights, 0..1. Default 0.9. */
  follow?: number;
  /** Take each disc's colour from its own highlight instead of `tints`. Default true. */
  tintFromSource?: boolean;
  /** Scroll mapping. Default `{ start: 1, end: 0 }`. Pass false to drive it yourself. */
  scroll?: ScrollProgressOptions | false;
  /** Starting progress when `scroll` is false. Default 0. */
  progress?: number;
  /** Number of discs. Default 20, capped at 64. */
  count?: number;
  /** Base disc diameter as a fraction of the host's short side. Default 0.16. */
  size?: number;
  /** Diameter spread across the field, 0..1. Default 0.55. */
  variance?: number;
  /** Edge falloff, 0 = hard aperture cut, 1 = pure diffuse glow. Default 0.82. */
  softness?: number;
  /** Brightness of the ring at the disc edge, 0..1. Default 0.28. */
  rim?: number;
  /** Aperture blades: 0 for round, 3..9 for polygonal. Default 0. WebGL renderer only. */
  blades?: number;
  /** Overall disc brightness, 0..1. Default 0.42. */
  intensity?: number;
  /** Shimmer depth, 0..1. Default 0.7. */
  shimmer?: number;
  /** Twinkles per disc across the whole scroll range. Default 7. */
  shimmerRate?: number;
  /** Vertical travel across the scroll range, in host heights. Default 0.6. Anchored discs barely travel. */
  parallax?: number;
  /** Idle sway and shimmer crawl, in cycles per second. Default 0.05. Time-driven, so reduced motion stops it. */
  drift?: number;
  /** Palette for discs with no highlight colour. Default four warm/cool film tints. */
  tints?: string[];
  /** PRNG seed; same seed, same field. Default 1. */
  seed?: number;
}

export interface BokehHandle extends Effect<BokehOptions> {
  /** Drives the field manually, 0..1. Only meaningful when `scroll` is false. */
  setProgress(progress: number): void;
  /** Re-reads highlights from the source. Call after a video seeks or the artwork changes. */
  resample(): void;
  /** Which renderer actually took the job. */
  readonly activeRenderer: 'webgl' | 'css';
  /** How many discs are sitting on a detected highlight rather than placed freely. */
  readonly anchoredCount: number;
}

/** What both renderers are handed: one resolved disc list plus the look options. */
export interface BokehConfig {
  discs: BokehDisc[];
  softness: number;
  rim: number;
  blades: number;
  intensity: number;
  shimmer: number;
  shimmerRate: number;
  parallax: number;
  drift: number;
  tints: string[];
  seed: number;
}

/** The contract both renderers implement. Progress is the only per-frame path. */
export interface BokehRendererInstance {
  setProgress(progress: number): void;
  setOptions(config: BokehConfig): void;
  resize(): void;
  destroy(): void;
}

type ResolvedOptions = Required<BokehOptions>;

const DEFAULT_TINTS = ['#ffcf8f', '#ff9fc4', '#8ecaff', '#fff0c2'];

const DEFAULTS: ResolvedOptions = {
  renderer: 'auto',
  source: 'auto',
  follow: 0.9,
  tintFromSource: true,
  scroll: { start: 1, end: 0 },
  progress: 0,
  count: 20,
  size: 0.16,
  variance: 0.55,
  softness: 0.7,
  rim: 0.28,
  blades: 0,
  intensity: 0.7,
  shimmer: 0.7,
  shimmerRate: 7,
  parallax: 0.6,
  drift: 0.05,
  tints: DEFAULT_TINTS,
  seed: 1,
};

/** Sample grid width. Wide enough to separate lamps, small enough that the readback is free. */
const SAMPLE_WIDTH = 96;
/**
 * A highlight closer than this to another is the same lamp, so one disc covers
 * both. It also thins out how much the field overlaps itself, which is what the
 * CSS renderer pays for: in Gecko, clustered discs cost ~25ms p95 on a synthetic
 * 90-step scrub against 17ms for a spread field.
 */
const SAMPLE_SEPARATION = 0.11;
/** Fraction of the strongest peak a candidate must reach to count as a highlight. */
const SAMPLE_THRESHOLD = 0.16;

let scratch: CanvasRenderingContext2D | null | undefined;

function scratchContext(): CanvasRenderingContext2D | null {
  if (scratch === undefined) {
    scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  return scratch;
}

function mediaSize(media: HTMLImageElement | HTMLVideoElement): [number, number] {
  return media instanceof HTMLVideoElement
    ? [media.videoWidth, media.videoHeight]
    : [media.naturalWidth, media.naturalHeight];
}

function resolveSource(
  host: HTMLElement,
  source: BokehSource,
): HTMLImageElement | HTMLVideoElement | null {
  if (source === 'none') return null;
  if (source === 'auto') return host.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
  if (typeof source === 'string') return document.querySelector<HTMLImageElement>(source);
  return source;
}

/**
 * Draws the media the way the browser is already drawing it — `object-fit` and
 * the element's own box inside the host — so a detected highlight lands on the
 * pixel the reader can see, not on an untransformed copy of the source.
 */
function sampleHighlights(
  host: HTMLElement,
  media: HTMLImageElement | HTMLVideoElement,
  count: number,
): Highlight[] {
  const context = scratchContext();
  const [sourceWidth, sourceHeight] = mediaSize(media);
  const hostBox = host.getBoundingClientRect();
  const mediaBox = media.getBoundingClientRect();
  if (
    context === null ||
    sourceWidth === 0 ||
    sourceHeight === 0 ||
    hostBox.width === 0 ||
    hostBox.height === 0 ||
    mediaBox.width === 0 ||
    mediaBox.height === 0
  ) {
    return [];
  }

  const width = SAMPLE_WIDTH;
  const height = Math.max(1, Math.round((width * mediaBox.height) / mediaBox.width));
  const fit = getComputedStyle(media).objectFit;

  // Crop the source the way object-fit does, then the sample grid is the
  // element's own box in normalised coordinates.
  let crop = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  if (fit !== 'fill') {
    const sourceAspect = sourceWidth / sourceHeight;
    const boxAspect = mediaBox.width / mediaBox.height;
    const cropWide = fit === 'contain' ? sourceAspect < boxAspect : sourceAspect > boxAspect;
    if (cropWide) {
      const cropWidth = sourceHeight * boxAspect;
      crop = { x: (sourceWidth - cropWidth) / 2, y: 0, width: cropWidth, height: sourceHeight };
    } else {
      const cropHeight = sourceWidth / boxAspect;
      crop = { x: 0, y: (sourceHeight - cropHeight) / 2, width: sourceWidth, height: cropHeight };
    }
  }

  const canvas = context.canvas;
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);

  let pixels: Uint8ClampedArray;
  try {
    context.drawImage(media, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    pixels = context.getImageData(0, 0, width, height).data;
  } catch (error) {
    // A cross-origin image taints the canvas. That is a normal deployment, not a
    // bug: fall back to the free field rather than breaking the effect.
    console.warn('bokeh: the source could not be read, placing discs freely instead.', error);
    return [];
  }

  const found = findHighlights(pixels, {
    width,
    height,
    count,
    threshold: SAMPLE_THRESHOLD,
    separation: SAMPLE_SEPARATION,
  });

  const offsetX = (mediaBox.left - hostBox.left) / hostBox.width;
  const offsetY = (mediaBox.top - hostBox.top) / hostBox.height;
  const scaleX = mediaBox.width / hostBox.width;
  const scaleY = mediaBox.height / hostBox.height;

  for (const highlight of found) {
    highlight.x = offsetX + highlight.x * scaleX;
    highlight.y = offsetY + highlight.y * scaleY;
  }
  return found;
}

function resolveOptions(base: ResolvedOptions, patch: BokehOptions): ResolvedOptions {
  const next: ResolvedOptions = { ...base };
  for (const key in patch) {
    const value = patch[key as keyof BokehOptions];
    // An explicit undefined means "leave this alone", not "reset to default".
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  return next;
}

export function createBokeh(host: HTMLElement, options: BokehOptions = {}): BokehHandle {
  let config = resolveOptions(DEFAULTS, options);
  let progress = clamp01(config.progress);
  let anchors: Highlight[] = [];
  let discs: BokehDisc[] = [];
  let destroyed = false;
  let stopScroll: (() => void) | null = null;
  let stopMediaWatch: (() => void) | null = null;

  function tints(): string[] {
    return config.tints.length > 0 ? config.tints : DEFAULT_TINTS;
  }

  function buildDiscs(): void {
    discs = createDiscs({
      count: config.count,
      size: config.size,
      variance: config.variance,
      tints: tints().length,
      seed: config.seed,
      anchors,
      follow: config.follow,
      tintFromSource: config.tintFromSource,
    });
  }

  function bokehConfig(): BokehConfig {
    return {
      discs,
      softness: config.softness,
      rim: config.rim,
      blades: config.blades,
      intensity: config.intensity,
      shimmer: config.shimmer,
      shimmerRate: config.shimmerRate,
      parallax: config.parallax,
      drift: config.drift,
      tints: tints(),
      seed: config.seed,
    };
  }

  /** Reads the source and rebuilds the field. Returns true when the anchors moved. */
  function scan(): boolean {
    const media = resolveSource(host, config.source);
    const next = media === null ? [] : sampleHighlights(host, media, config.count);
    const changed =
      next.length !== anchors.length ||
      next.some((highlight, index) => highlight.x !== anchors[index].x || highlight.y !== anchors[index].y);
    anchors = next;
    if (changed) buildDiscs();
    return changed;
  }

  /**
   * An `<img>` that has not decoded yet, and a `<video>` that has not painted a
   * frame, both sample as empty — so the scan is repeated once they have pixels.
   */
  function watchMedia(): void {
    stopMediaWatch?.();
    stopMediaWatch = null;

    const media = resolveSource(host, config.source);
    if (media === null) return;

    const rescan = (): void => {
      if (destroyed) return;
      scan();
      current.instance.setOptions(bokehConfig());
      current.instance.setProgress(progress);
    };

    const events = media instanceof HTMLVideoElement ? ['loadeddata', 'seeked'] : ['load'];
    for (const event of events) media.addEventListener(event, rescan);
    stopMediaWatch = (): void => {
      for (const event of events) media.removeEventListener(event, rescan);
    };
  }

  function build(): { instance: BokehRendererInstance; kind: 'webgl' | 'css' } {
    if (config.renderer !== 'css') {
      const webgl = createWebglBokehRenderer(host, bokehConfig());
      if (webgl !== null) return { instance: webgl, kind: 'webgl' };
      console.warn('bokeh: WebGL2 is unavailable, rendering through the CSS renderer.');
    }
    return { instance: createCssBokehRenderer(host, bokehConfig()), kind: 'css' };
  }

  scan();
  let current = build();
  watchMedia();

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

  // The host box drives both the sample mapping and the disc geometry, so a
  // resize re-reads the source; this is the only readback outside construction.
  const stopResize = onResize(host, () => {
    if (scan()) current.instance.setOptions(bokehConfig());
    current.instance.resize();
  });

  current.instance.setProgress(progress);
  syncScroll();

  return {
    get activeRenderer(): 'webgl' | 'css' {
      return current.kind;
    },

    get anchoredCount(): number {
      let anchored = 0;
      for (const disc of discs) if (disc.anchored > 0) anchored += 1;
      return anchored;
    },

    setOptions(patch: BokehOptions): void {
      if (destroyed) return;
      const previous = config;
      config = resolveOptions(config, patch);

      if (config.source !== previous.source) {
        scan();
        watchMedia();
      } else if (
        config.count !== previous.count ||
        config.size !== previous.size ||
        config.variance !== previous.variance ||
        config.seed !== previous.seed ||
        config.follow !== previous.follow ||
        config.tintFromSource !== previous.tintFromSource ||
        config.tints !== previous.tints
      ) {
        buildDiscs();
      }

      if (config.renderer !== previous.renderer) {
        current.instance.destroy();
        current = build();
      }
      if (config.scroll !== previous.scroll) syncScroll();
      if (config.scroll === false && patch.progress !== undefined) {
        progress = clamp01(config.progress);
      }
      current.instance.setOptions(bokehConfig());
      current.instance.setProgress(progress);
    },

    setProgress(value: number): void {
      if (destroyed) return;
      progress = clamp01(value);
      current.instance.setProgress(progress);
    },

    resample(): void {
      if (destroyed) return;
      scan();
      current.instance.setOptions(bokehConfig());
      current.instance.setProgress(progress);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopScroll?.();
      stopScroll = null;
      stopMediaWatch?.();
      stopMediaWatch = null;
      stopResize();
      current.instance.destroy();
    },
  };
}

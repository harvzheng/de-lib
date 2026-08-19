/**
 * Crumpled Paper — whatever is in the host ends up looking printed on a sheet that
 * was screwed up in a fist and flattened out again: irregular panels, creases where
 * they meet, fibre tooth, and dirt in the folds.
 *
 * Two renderers, and the WebGL one is the one that convinces. It evaluates the sheet
 * per pixel as a **max of cones** — a power diagram, which is what a crumpled sheet
 * geometrically is — and takes its normals from float-precision finite differences.
 * The CSS/SVG renderer draws the same idea as summed gradient ellipses baked into an
 * 8-bit height map and lights it with `feDiffuseLighting`; it holds up on its own,
 * but 8-bit alpha limits how much relief it can carry before the folds band.
 *
 * Everything is static by default: the map (CSS) or the quad (WebGL) is redrawn only
 * when an option changes, and — if `lightShift` is set — when scroll moves the light.
 * There is no per-frame work in either path.
 */

import { createLayer, onResize } from '../../core/dom';
import { createFilter } from '../../core/svg';
import { onScrollProgress } from '../../core/scroll';
import { createCssCrumpleRenderer } from './renderer-css';
import { createWebglCrumpleRenderer } from './renderer-webgl';
import type { FilterHandle } from '../../core/svg';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { Effect } from '../../core/types';

export type CrumpleRenderer = 'auto' | 'webgl' | 'css';

export interface CrumpledPaperOptions {
  /** 'auto' prefers WebGL, falls back to CSS when WebGL2 is unavailable. Default 'auto'. */
  renderer?: CrumpleRenderer;
  /** Px across a panel: how hard the sheet was crumpled. Default 240. */
  scale?: number;
  /** Crease depth, 0..1 — relief and how much shading lands. Default 0.6. */
  depth?: number;
  /** 0..1 — how much fine wrinkling rides on the broad panels. Default 0.65. */
  creases?: number;
  /** Direction the light comes from, in degrees clockwise from the left. Default 135. */
  light?: number;
  /** Specular sheen along the creases, 0..1. Default 0.3. */
  shine?: number;
  /** Paper stock the sheet is toned toward. Default '#f2ece0'. */
  paperColor?: string;
  /** How far the content is toned toward `paperColor`, 0..1. Default 0.35. */
  tone?: number;
  /** Fibre tooth, 0..1. Default 0.4. */
  grain?: number;
  /** Darkening in the deep folds, 0..1. Default 0.4. */
  soiling?: number;
  /** How far the content itself is dragged along the creases, in px. Default 2. */
  warp?: number;
  /**
   * Degrees the light swings across the scroll range. Default 0 — set it and the
   * sheet catches the light as the reader scrolls. Scroll-scrubbed, so reduced
   * motion keeps it.
   */
  lightShift?: number;
  /** Scroll mapping used by `lightShift`. Default `{ start: 1, end: 0 }`. */
  scroll?: ScrollProgressOptions | false;
  /** PRNG seed; same seed, same sheet. Default 1. */
  seed?: number;
}

export interface CrumpledPaperHandle extends Effect<CrumpledPaperOptions> {
  /** Which renderer actually took the job. */
  readonly activeRenderer: 'webgl' | 'css';
}

/** What both renderers are handed: the look, resolved. */
export interface CrumpledConfig {
  scale: number;
  depth: number;
  creases: number;
  light: number;
  shine: number;
  paperColor: string;
  tone: number;
  grain: number;
  soiling: number;
  seed: number;
}

/** The contract both renderers implement. */
export interface CrumpledRendererInstance {
  setOptions(config: CrumpledConfig): void;
  /** The light azimuth in degrees, which is the only value scroll can move. */
  setLight(azimuth: number): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

type ResolvedOptions = Required<CrumpledPaperOptions>;

const DEFAULTS: ResolvedOptions = {
  renderer: 'auto',
  scale: 240,
  depth: 0.6,
  creases: 0.65,
  light: 135,
  shine: 0.3,
  paperColor: '#f2ece0',
  tone: 0.35,
  grain: 0.4,
  soiling: 0.4,
  warp: 2,
  lightShift: 0,
  scroll: { start: 1, end: 0 },
  seed: 1,
};

/**
 * Drags the host's own pixels along the creases — the one part of the effect that
 * has to reach inside the host, so it is a CSS `filter` on the host itself and
 * belongs to neither renderer.
 *
 * The field is turbulence rather than the sheet's own: `feDisplacementMap` needs its
 * map as a filter input, and feeding either renderer's field in would mean
 * `feImage`, whose data-URL support is the least even thing in the filter spec. At a
 * couple of px the difference is invisible; past about 6px it is not, which is why
 * `warp` stays small.
 */
const WARP_FILTER = `
<filter color-interpolation-filters="sRGB" x="-4%" y="-4%" width="108%" height="108%">
  <feTurbulence data-p="field" type="turbulence" baseFrequency="0.004" numOctaves="3"
    seed="1" stitchTiles="stitch" result="field"/>
  <feDisplacementMap data-p="displace" in="SourceGraphic" in2="field" scale="2"
    xChannelSelector="R" yChannelSelector="G"/>
</filter>`;

function resolveOptions(base: ResolvedOptions, patch: CrumpledPaperOptions): ResolvedOptions {
  const next: ResolvedOptions = { ...base };
  for (const key in patch) {
    const value = patch[key as keyof CrumpledPaperOptions];
    // An explicit undefined means "leave this alone", not "reset to default".
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  return next;
}

export function createCrumpledPaper(
  host: HTMLElement,
  options: CrumpledPaperOptions = {},
): CrumpledPaperHandle {
  let config = resolveOptions(DEFAULTS, options);
  let progress = 0;
  let width = 0;
  let height = 0;
  let destroyed = false;
  let stopScroll: (() => void) | null = null;

  const stack = createLayer(host, 'div', 'crumpled-paper-stack');
  stack.setAttribute('aria-hidden', 'true');

  const warpFilter: FilterHandle = createFilter(WARP_FILTER, 'crumpled-paper-warp');
  /**
   * Composed with, not replaced: a host that already carried a filter keeps it while
   * the warp is active, and gets it back untouched on destroy. CSS filter lists apply
   * left to right, so the host's own filter runs first and the warp displaces its
   * result. `none` is the initial value rather than a filter and cannot appear in a
   * list - `none url(#id)` is invalid and drops the whole declaration.
   */
  const hostFilterBefore = host.style.filter;
  const hostFilterBase = hostFilterBefore === 'none' ? '' : hostFilterBefore;

  function crumpledConfig(): CrumpledConfig {
    return {
      scale: config.scale,
      depth: config.depth,
      creases: config.creases,
      light: config.light,
      shine: config.shine,
      paperColor: config.paperColor,
      tone: config.tone,
      grain: config.grain,
      soiling: config.soiling,
      seed: config.seed,
    };
  }

  function build(): { instance: CrumpledRendererInstance; kind: 'webgl' | 'css' } {
    if (config.renderer !== 'css') {
      const webgl = createWebglCrumpleRenderer(stack, crumpledConfig());
      if (webgl !== null) return { instance: webgl, kind: 'webgl' };
      console.warn('crumpled-paper: WebGL2 is unavailable, rendering through the CSS renderer.');
    }
    return { instance: createCssCrumpleRenderer(stack, crumpledConfig()), kind: 'css' };
  }

  let current = build();

  function lightAngle(): number {
    return config.light + config.lightShift * (progress - 0.5);
  }

  function pushWarp(): void {
    if (config.warp > 0) {
      warpFilter.set('field', {
        baseFrequency: (1 / Math.max(24, config.scale)).toFixed(6),
        seed: Math.round(config.seed),
      });
      warpFilter.set('displace', { scale: config.warp.toFixed(2) });
      host.style.filter =
        hostFilterBase === '' ? warpFilter.css : `${hostFilterBase} ${warpFilter.css}`;
    } else {
      host.style.filter = hostFilterBefore;
    }
  }

  function syncScroll(): void {
    stopScroll?.();
    stopScroll = null;
    // Without a light swing there is nothing for scroll position to drive.
    if (config.scroll === false || config.lightShift === 0) return;
    stopScroll = onScrollProgress(
      host,
      (value) => {
        progress = value;
        current.instance.setLight(lightAngle());
      },
      config.scroll,
    );
  }

  // Panel size is in px, so a resized host is re-creased rather than having its
  // sheet stretched.
  const stopResize = onResize(host, (nextWidth, nextHeight) => {
    width = nextWidth;
    height = nextHeight;
    current.instance.resize(width, height);
  });

  width = host.clientWidth;
  height = host.clientHeight;
  current.instance.resize(width, height);
  current.instance.setLight(lightAngle());
  pushWarp();
  syncScroll();

  return {
    get activeRenderer(): 'webgl' | 'css' {
      return current.kind;
    },

    setOptions(patch: CrumpledPaperOptions): void {
      if (destroyed) return;
      const previous = config;
      config = resolveOptions(config, patch);

      if (config.renderer !== previous.renderer) {
        current.instance.destroy();
        current = build();
        current.instance.resize(width, height);
      }
      current.instance.setOptions(crumpledConfig());
      current.instance.setLight(lightAngle());

      if (config.warp !== previous.warp || config.scale !== previous.scale) pushWarp();
      if (config.scroll !== previous.scroll || config.lightShift !== previous.lightShift) {
        syncScroll();
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopScroll?.();
      stopScroll = null;
      stopResize();
      host.style.filter = hostFilterBefore;
      warpFilter.destroy();
      current.instance.destroy();
      stack.remove();
    },
  };
}

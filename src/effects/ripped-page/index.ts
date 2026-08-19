/**
 * Ripped Page — the outgoing shot is a printed page that tears in half and pulls
 * apart to reveal the next one. Cut in the travel-edit idiom: the tear holds
 * still, snaps, then decelerates; the two halves hinge off one end of the rip so
 * the gap opens as a widening wedge rather than sliding apart in parallel; and
 * the incoming shot settles out of a punch-in behind it.
 *
 * No WebGL. The tear is a deterministic polyline (`tear.ts`) used twice: as a
 * `clip-path` polygon on each half, and as the `d` of a stroked SVG path that
 * paints the white fibre edge, roughened by one shared SVG filter. Because the
 * clip is static and the halves hinge on a pivot, every frame writes nothing but
 * `transform` and `opacity`.
 */

import { createLayer, loadImage, loadVideo, onResize } from '../../core/dom';
import { clamp, clamp01, easeOutCubic } from '../../core/math';
import { onScrollProgress } from '../../core/scroll';
import { createFilter } from '../../core/svg';
import { buildTear } from './tear';
import type { FilterHandle } from '../../core/svg';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { Effect } from '../../core/types';
import type { TearAxis, TearGeometry, TearPivot } from './tear';

export type RippedPageMedia = HTMLImageElement | HTMLVideoElement;

export interface RippedPageOptions {
  /** Outgoing shot — the page that tears. A URL, or an element you already have. */
  from: string | RippedPageMedia;
  /** Incoming shot, revealed through the tear. */
  to: string | RippedPageMedia;
  /** Scroll mapping. Default the pinned scrub `{ start: 0, end: 1 }`. Pass false to drive it yourself. */
  scroll?: ScrollProgressOptions | false;
  /** Starting progress when `scroll` is false. Default 0. */
  progress?: number;
  /** Which way the rip runs. Default 'horizontal'. */
  axis?: TearAxis;
  /** Tilt of the rip in degrees, clamped to ±35. Default -7. */
  angle?: number;
  /** Where the rip crosses the frame, 0..1. Default 0.52. */
  offset?: number;
  /** How far the rip wanders, 0..1. Default 0.55. */
  roughness?: number;
  /** Length of the fibre tufts along the rip, 0..1. Default 0.5. */
  fiber?: number;
  /** Which end of the rip the halves hinge on. Default 'start'. */
  pivot?: TearPivot;
  /** Width of the torn paper edge in px. Default 3. */
  edge?: number;
  /** Colour of that edge — the paper's own stock, not its print. Default '#fdf6e8'. */
  edgeColor?: string;
  /** How far the halves travel at full tear, in frame heights. Default 0.85. */
  separation?: number;
  /** Counter-rotation of the halves at full tear, in degrees. Default 9. */
  rotation?: number;
  /** Scroll fraction the rip waits before it lets go, 0..0.6. Default 0.12. */
  hold?: number;
  /** Punch-in the revealed shot settles out of, 0..0.4. Default 0.12. */
  zoom?: number;
  /** Depth of the shadow the torn halves cast into the gap, 0..1. Default 0.55. */
  shadow?: number;
  /** Paper grain over the halves, 0..1. Default 0.3. */
  grain?: number;
  /** PRNG seed; same seed, same rip. Default 1. */
  seed?: number;
}

export interface RippedPageHandle extends Effect<RippedPageOptions> {
  /** Drives the tear manually, 0..1. Only meaningful when `scroll` is false. */
  setProgress(progress: number): void;
}

type ResolvedOptions = Required<RippedPageOptions>;

const DEFAULTS = {
  scroll: { start: 0, end: 1 },
  progress: 0,
  axis: 'horizontal',
  angle: -7,
  offset: 0.52,
  roughness: 0.55,
  fiber: 0.5,
  pivot: 'start',
  edge: 3,
  edgeColor: '#fdf6e8',
  separation: 0.95,
  rotation: 9,
  hold: 0.12,
  zoom: 0.12,
  shadow: 0.55,
  grain: 0.3,
  seed: 1,
} satisfies Omit<ResolvedOptions, 'from' | 'to'>;

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIDEO_SOURCE = /\.(mp4|webm|ogv|mov)(?:[?#]|$)/i;

/**
 * Roughens the fibre stroke so the edge reads as paper rather than as a stroked
 * polyline. Static: the tear does not change shape once it is torn, so nothing
 * here is written per frame.
 */
const FIBER_FILTER = `
<filter color-interpolation-filters="sRGB" x="-4%" y="-4%" width="108%" height="108%">
  <feTurbulence type="fractalNoise" baseFrequency="0.7 0.34" numOctaves="3" seed="4" result="fibres"/>
  <feDisplacementMap data-p="displace" in="SourceGraphic" in2="fibres" scale="4"
    xChannelSelector="R" yChannelSelector="G"/>
</filter>`;

/** The shadow needs its own blur, and blur radius is the only thing tied to `edge`. */
const SHADOW_FILTER = `
<filter color-interpolation-filters="sRGB" x="-12%" y="-12%" width="124%" height="124%">
  <feGaussianBlur data-p="blur" in="SourceGraphic" stdDeviation="7"/>
</filter>`;

function resolveOptions(base: ResolvedOptions, patch: Partial<RippedPageOptions>): ResolvedOptions {
  const next: ResolvedOptions = { ...base };
  for (const key in patch) {
    const value = patch[key as keyof RippedPageOptions];
    // An explicit undefined means "leave this alone", not "reset to default".
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  return next;
}

function resolveMedia(source: string | RippedPageMedia): Promise<RippedPageMedia> {
  if (typeof source === 'string') {
    return VIDEO_SOURCE.test(source) ? loadVideo(source) : loadImage(source);
  }
  if (source instanceof HTMLVideoElement) {
    if (source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve(source);
    const { promise, resolve } = Promise.withResolvers<RippedPageMedia>();
    source.addEventListener('loadeddata', () => resolve(source), { once: true });
    return promise;
  }
  return source.complete ? Promise.resolve(source) : source.decode().then(() => source);
}

/** A second element for the second half: one media element cannot be clipped two ways. */
function cloneMedia(media: RippedPageMedia): RippedPageMedia {
  if (media instanceof HTMLVideoElement) {
    const video = document.createElement('video');
    video.src = media.currentSrc || media.src;
    video.muted = true;
    video.loop = media.loop;
    video.playsInline = true;
    video.autoplay = true;
    void video.play().catch(() => {
      // A refused autoplay leaves the poster frame, which is a valid page to tear.
    });
    return video;
  }
  const image = document.createElement('img');
  image.src = media.currentSrc || media.src;
  image.alt = '';
  image.decoding = 'async';
  return image;
}

export function createRippedPage(
  host: HTMLElement,
  options: RippedPageOptions,
): RippedPageHandle {
  let config = resolveOptions({ ...DEFAULTS, from: options.from, to: options.to }, options);
  let progress = clamp01(config.progress);
  let geometry: TearGeometry | null = null;
  let width = 0;
  let height = 0;
  let loadToken = 0;
  let destroyed = false;
  let stopScroll: (() => void) | null = null;

  const stack = createLayer(host, 'div', 'ripped-page-stack');
  stack.setAttribute('aria-hidden', 'true');
  const frame = document.createElement('div');
  frame.className = 'ripped-page-frame';
  stack.append(frame);

  const reveal = document.createElement('div');
  reveal.className = 'ripped-page-reveal';
  const shadow = document.createElementNS(SVG_NS, 'svg');
  shadow.setAttribute('class', 'ripped-page-shadow');
  shadow.setAttribute('preserveAspectRatio', 'none');
  const shadowPath = document.createElementNS(SVG_NS, 'path');
  shadow.append(shadowPath);

  const lead = document.createElement('div');
  lead.className = 'ripped-page-half ripped-page-half--lead';
  const trail = document.createElement('div');
  trail.className = 'ripped-page-half ripped-page-half--trail';

  const fibreFilter: FilterHandle = createFilter(FIBER_FILTER, 'ripped-page-fibres');
  const shadowFilter: FilterHandle = createFilter(SHADOW_FILTER, 'ripped-page-shadow');
  // The blur goes on the path, not on the <svg> that carries the animated opacity:
  // Gecko re-rasterises a filtered element whenever its own opacity changes — 10 of
  // 86 scrub frames over 20ms, against none once the two are on separate elements.
  shadowPath.style.filter = shadowFilter.css;

  /** Per half: the fibre edge drawn on top of that half's own copy of the page. */
  function buildHalf(half: HTMLElement): SVGPathElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ripped-page-fibres');
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'ripped-page-fibre-path');
    path.style.filter = fibreFilter.css;
    svg.append(path);
    half.append(svg);
    return path;
  }

  const leadFibre = buildHalf(lead);
  const trailFibre = buildHalf(trail);
  frame.append(reveal, shadow, lead, trail);

  const grain = document.createElement('div');
  grain.className = 'ripped-page-grain';
  frame.append(grain);

  function applyGeometry(): void {
    if (width === 0 || height === 0) return;

    geometry = buildTear({
      width,
      height,
      axis: config.axis,
      angle: config.angle,
      offset: config.offset,
      roughness: config.roughness,
      fiber: config.fiber,
      pivotAt: config.pivot,
      seed: config.seed,
    });

    lead.style.clipPath = geometry.leadClip;
    trail.style.clipPath = geometry.trailClip;
    // Both halves hinge on the same point, which is what opens the rip as a
    // wedge: rotating about the middle would slide them apart in parallel.
    const origin = `${geometry.pivot.x}px ${geometry.pivot.y}px`;
    lead.style.transformOrigin = origin;
    trail.style.transformOrigin = origin;
    shadow.style.transformOrigin = origin;

    const viewBox = `0 0 ${width} ${height}`;
    for (const svg of [shadow, lead.firstElementChild, trail.firstElementChild]) {
      (svg as SVGSVGElement | null)?.setAttribute('viewBox', viewBox);
    }
    leadFibre.setAttribute('d', geometry.edgePath);
    trailFibre.setAttribute('d', geometry.edgePath);
    shadowPath.setAttribute('d', geometry.edgePath);
  }

  function pushLook(): void {
    frame.style.setProperty('--ripped-page-edge', `${config.edge}px`);
    frame.style.setProperty('--ripped-page-edge-color', config.edgeColor);
    grain.style.opacity = String(clamp01(config.grain) * 0.5);
    // Wider paper edge, deeper shadow: the two read as one sheet thickness.
    shadowFilter.set('blur', { stdDeviation: (2.2 + config.edge * 1.6).toFixed(2) });
    fibreFilter.set('displace', { scale: (1 + config.fiber * 6).toFixed(2) });
  }

  function draw(): void {
    if (destroyed || geometry === null) return;

    const hold = clamp(config.hold, 0, 0.6);
    const t = clamp01((progress - hold) / Math.max(1 - hold, 1e-3));
    // Two curves, because a tear is two events. The hinge opens early and
    // decelerates — that is the snap, and it is what the reader sees most of.
    // The halves only leave late, so the scrub is spent on the rip rather than
    // on two rectangles travelling off-frame.
    const open = easeOutCubic(t);
    const fly = t ** 2.4;

    const vertical = config.axis === 'vertical';
    const across = vertical ? width : height;
    const travel = config.separation * across * fly;
    // The parting that the hinge alone opens, before anything flies.
    const part = across * 0.035 * open;
    const spin = config.rotation * open;
    // A little slide along the rip as well, or the halves read as hinged panels
    // rather than as paper coming away in the hand.
    const slide = travel * 0.14;

    const leadShift = vertical
      ? `${-(part + travel)}px, ${-slide}px`
      : `${-slide}px, ${-(part + travel)}px`;
    const trailShift = vertical
      ? `${part + travel}px, ${slide}px`
      : `${slide}px, ${part + travel}px`;
    lead.style.transform = `translate3d(${leadShift}, 0) rotate(${-spin}deg)`;
    trail.style.transform = `translate3d(${trailShift}, 0) rotate(${spin}deg)`;

    shadow.style.transform = lead.style.transform;
    // The shadow needs an edge close enough to the page beneath it to catch on;
    // it arrives with the hinge and is gone once the halves have flown.
    shadow.style.opacity = String(clamp01(config.shadow) * open * (1 - fly));

    reveal.style.transform = `scale(${(1 + config.zoom * (1 - open)).toFixed(4)})`;
  }

  function syncMedia(): void {
    const token = (loadToken += 1);
    void Promise.all([resolveMedia(config.from), resolveMedia(config.to)])
      .then(([from, to]) => {
        // A later from/to, or a destroy, landed while these were decoding.
        if (destroyed || token !== loadToken) return;

        for (const [half, media] of [
          [lead, from],
          [trail, cloneMedia(from)],
        ] as const) {
          half.querySelector('img, video')?.remove();
          half.prepend(media);
        }
        reveal.querySelector('img, video')?.remove();
        reveal.prepend(to);

        applyGeometry();
        draw();
      })
      .catch((error: unknown) => {
        console.error('ripped-page: media failed to load.', error);
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
        draw();
      },
      config.scroll,
    );
  }

  const stopResize = onResize(frame, (nextWidth, nextHeight) => {
    width = nextWidth;
    height = nextHeight;
    applyGeometry();
    draw();
  });

  width = frame.clientWidth;
  height = frame.clientHeight;
  pushLook();
  applyGeometry();
  syncMedia();
  syncScroll();
  draw();

  return {
    setOptions(patch: Partial<RippedPageOptions>): void {
      if (destroyed) return;
      const previous = config;
      config = resolveOptions(config, patch);

      if (config.from !== previous.from || config.to !== previous.to) syncMedia();
      if (config.scroll !== previous.scroll) syncScroll();
      if (config.scroll === false && patch.progress !== undefined) {
        progress = clamp01(config.progress);
      }

      pushLook();
      if (
        config.axis !== previous.axis ||
        config.angle !== previous.angle ||
        config.offset !== previous.offset ||
        config.roughness !== previous.roughness ||
        config.fiber !== previous.fiber ||
        config.pivot !== previous.pivot ||
        config.seed !== previous.seed
      ) {
        applyGeometry();
      }
      draw();
    },

    setProgress(value: number): void {
      if (destroyed) return;
      progress = clamp01(value);
      draw();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      loadToken += 1;
      stopScroll?.();
      stopScroll = null;
      stopResize();
      fibreFilter.destroy();
      shadowFilter.destroy();
      stack.remove();
    },
  };
}

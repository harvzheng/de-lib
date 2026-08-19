/**
 * Wiggly Text - type that wobbles like a hand-redrawn line.
 *
 * The wiggle is a displacement of the pixels the host already painted, driven by
 * a turbulence field that swaps out a few times a second. That is what makes it
 * font- and text-agnostic: nothing here measures a glyph, splits a string, wraps
 * a character in a `<span>` or asks the font for anything. A heading, a numeral,
 * an emoji, an icon-font ligature, a right-to-left paragraph and a `<sup>` in the
 * middle of a line all wiggle the same way, and the text underneath stays real -
 * selectable, searchable, translatable, and readable by a screen reader.
 */

import { onResize, onVisible } from '../../core/dom';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { createFilter } from '../../core/svg';
import {
  baseFrequency,
  composeFilter,
  displacementScale,
  edgeReconstruction,
  filterRegion,
  frameIndex,
  octaveCount,
  wiggleFrames,
} from './wiggle';
import type { FilterHandle } from '../../core/svg';
import type { Effect } from '../../core/types';
import type { WiggleFrame } from './wiggle';

export interface WigglyTextOptions {
  /** Peak excursion in px. Default 2.2. Past roughly a tenth of the font size, stems tear. */
  amplitude?: number;
  /** Px between wobbles. Short reads as a boiling edge, long as a drunk baseline. Default 90. */
  wavelength?: number;
  /** 0..1 fine chatter riding on the main wobble. Default 0.35. */
  roughness?: number;
  /** Redraws per second. Default 8. Set 0 to hold a single wiggled frame. */
  boil?: number;
  /** Drawings in the repeating cycle. Default 3, as in hand-drawn animation. */
  frames?: number;
  /**
   * 0..1 edge reconstruction after displacement. Default 0.7. Set 0 for a host whose
   * content is deliberately soft-edged - a glow, a drop shadow, a feathered PNG -
   * since steepening alpha is what hardens those.
   */
  crisp?: number;
  /** PRNG seed. Same seed, same wiggle. Default 1. */
  seed?: number;
}

export interface WigglyTextHandle extends Effect<WigglyTextOptions> {
  /** Frame of the cycle currently displayed. Demo-facing; not part of the look. */
  readonly frame: number;
}

type Resolved = Required<WigglyTextOptions>;

const DEFAULTS: Resolved = {
  amplitude: 2,
  wavelength: 90,
  roughness: 0.35,
  boil: 8,
  frames: 3,
  crisp: 0.7,
  seed: 1,
};

/**
 * `type="fractalNoise"` rather than `turbulence`: turbulence sums absolute-value
 * octaves, which puts creases in the field, and a crease in a displacement field
 * is a corner in a letter's outline - at a headline size that reads as torn paper
 * rather than as a redrawn line. `fractalNoise` bends.
 *
 * The blur and alpha ramp after the displacement are an edge *reconstruction*, and
 * they are the difference between this looking hand-drawn and looking like a bad
 * fax. `feDisplacementMap` fetches its source per device pixel with no filtering,
 * so displacing an antialiased edge by a fractional amount aliases it - visibly, at
 * a device pixel ratio of 1. Blurring by half a pixel and then steepening alpha
 * about its midpoint rebuilds a smooth edge without moving it or thickening the
 * stroke: the ramp is centred so the 50% crossing, which is where the eye reads the
 * edge, stays exactly where the displacement put it.
 */
const WIGGLE_FILTER = `
  <filter color-interpolation-filters="sRGB" x="-4%" y="-4%" width="108%" height="108%">
    <feTurbulence data-p="field" type="fractalNoise" baseFrequency="0.011" numOctaves="2" seed="1" result="field" />
    <feDisplacementMap data-p="displace" in="SourceGraphic" in2="field" scale="4.0" xChannelSelector="R" yChannelSelector="G" result="moved" />
    <feGaussianBlur data-p="soften" in="moved" stdDeviation="0.45" result="soft" />
    <feComponentTransfer in="soft">
      <feFuncA data-p="crispen" type="linear" slope="2.6" intercept="-0.8" />
    </feComponentTransfer>
  </filter>
`;

function resolve(base: Resolved, patch: WigglyTextOptions): Resolved {
  return {
    amplitude: patch.amplitude ?? base.amplitude,
    wavelength: patch.wavelength ?? base.wavelength,
    roughness: patch.roughness ?? base.roughness,
    boil: patch.boil ?? base.boil,
    frames: patch.frames ?? base.frames,
    crisp: patch.crisp ?? base.crisp,
    seed: patch.seed ?? base.seed,
  };
}

export function createWigglyText(
  host: HTMLElement,
  options: WigglyTextOptions = {},
): WigglyTextHandle {
  let config = resolve(DEFAULTS, options);
  let frames: WiggleFrame[] = wiggleFrames(config.frames, config.seed);
  let frame = -1;
  let elapsed = 0;
  let width = host.clientWidth;
  let height = host.clientHeight;
  let reduced = prefersReducedMotion();
  let visible = true;
  let stopTick: (() => void) | null = null;
  let destroyed = false;

  const filter: FilterHandle = createFilter(WIGGLE_FILTER, 'wiggly-text');
  /**
   * Composed with, not replaced: a host that already carried a filter keeps it, and
   * gets it back untouched on destroy. CSS filter lists apply left to right, so the
   * host's own filter runs first and the wiggle displaces its result - a wiggling
   * blurred heading, rather than a wiggling sharp one.
   *
   * `none` is the initial value rather than a filter, so it cannot appear in a list:
   * `none url(#id)` is invalid and drops the whole declaration.
   */
  const hostFilterBefore = host.style.filter;
  const composedFilter = composeFilter(hostFilterBefore, filter.css);

  /**
   * The region lives on the `<filter>` element, which is not a primitive, so it is
   * written directly rather than through `set`.
   */
  function pushRegion(): void {
    const region = filterRegion(config.amplitude, width, height);
    for (const attribute in region) {
      filter.element.setAttribute(attribute, region[attribute as keyof typeof region]);
    }
  }

  function pushField(): void {
    filter.set('field', {
      baseFrequency: baseFrequency(config.wavelength).toFixed(6),
      numOctaves: octaveCount(config.roughness),
    });
    filter.set('displace', { scale: displacementScale(config.amplitude).toFixed(2) });

    const edge = edgeReconstruction(config.crisp);
    filter.set('soften', { stdDeviation: edge.blur.toFixed(3) });
    filter.set('crispen', { slope: edge.slope.toFixed(3), intercept: edge.intercept.toFixed(3) });

    pushRegion();
    // Amplitude 0 is "off", and an identity displacement still costs a filter pass.
    host.style.filter = config.amplitude > 0 ? composedFilter : hostFilterBefore;
  }

  /** The only per-frame write: one attribute, and only when the frame actually changed. */
  function drawFrame(next: number): void {
    if (next === frame) return;
    frame = next;
    filter.set('field', { seed: frames[frame].seed });
  }

  function syncActivity(): void {
    // A held frame still wiggles - it is a drawing, just not a moving one. This is
    // what `prefers-reduced-motion` asks for, and it is also what `boil: 0` means.
    const animating = config.boil > 0 && config.amplitude > 0 && visible && !reduced;
    if (animating === (stopTick !== null)) return;

    if (!animating) {
      stopTick?.();
      stopTick = null;
      drawFrame(0);
      return;
    }
    stopTick = onTick((_now, deltaMs) => {
      elapsed += deltaMs;
      drawFrame(frameIndex(elapsed, 1000 / config.boil, frames.length));
    });
  }

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncActivity();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    syncActivity();
  });

  // The region is a percentage of the box, so a resized host needs it recomputed
  // or the wiggle starts clipping against the box it outgrew.
  const stopResize = onResize(host, (nextWidth, nextHeight) => {
    width = nextWidth;
    height = nextHeight;
    pushRegion();
  });

  pushField();
  drawFrame(0);
  syncActivity();

  return {
    get frame(): number {
      return frame;
    },

    setOptions(patch: WigglyTextOptions): void {
      if (destroyed) return;
      const previous = config;
      config = resolve(config, patch);

      if (config.frames !== previous.frames || config.seed !== previous.seed) {
        frames = wiggleFrames(config.frames, config.seed);
        // The cycle changed under the pointer, so the current index means nothing.
        frame = -1;
        elapsed = 0;
      }
      pushField();
      drawFrame(frame < 0 ? 0 : Math.min(frame, frames.length - 1));
      syncActivity();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopVisible();
      stopMotion();
      stopResize();
      host.style.filter = hostFilterBefore;
      filter.destroy();
    },
  };
}

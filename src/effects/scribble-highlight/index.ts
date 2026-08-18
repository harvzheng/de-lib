/**
 * Scribble Highlight — a hand-drawn annotation that draws itself around the
 * target, boils frame by frame like rough animation, then flutters away.
 *
 * The boil is the point: `frames` complete drawings are generated independently
 * and cycled at `fps`, the way an editor stacks separate crayon passes over
 * footage. Exactly one drawing is in the DOM at a time.
 */

import { createLayer, onResize, onVisible } from '../../core/dom';
import { clamp01, easeOutCubic, lerp, mulberry32 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { onScrollProgress } from '../../core/scroll';
import { createFilter } from '../../core/svg';
import { buildScribbleDrawings } from './paths';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { FilterHandle } from '../../core/svg';
import type { Effect } from '../../core/types';
import type { ScribbleStroke, ScribbleVariant } from './paths';

export type { ScribbleVariant } from './paths';

export interface ScribbleHighlightOptions {
  /** Default 'circle'. */
  variant?: ScribbleVariant;
  /** Any CSS colour. Default 'currentColor' resolved against the target. */
  color?: string;
  /** Stroke width in px. Default 3. */
  strokeWidth?: number;
  /** Independently redrawn drawings cycled to produce the boil. Default 6. */
  frames?: number;
  /** Boil rate in fps — the "on twos" stutter. Default 12. */
  fps?: number;
  /** Roughness of the hand, in px of deviation. Default 4. */
  jitter?: number;
  /** Overlapping strokes per drawing — a real hand goes round twice. Default 2. */
  passes?: number;
  /** Padding around the target's box, in px. Default 10. */
  padding?: number;
  /** PRNG seed; the same seed always produces the same drawings. Default 1. */
  seed?: number;
  /**
   * 'crayon' roughens the stroke edge with feTurbulence + feDisplacementMap,
   * re-seeded per boil frame. 'clean' is a plain stroke. Default 'crayon'.
   */
  texture?: 'crayon' | 'clean';
  /**
   * 'scroll' scrubs the draw-on by scroll position, 'inview' plays it once on
   * entry, 'manual' waits for setProgress. Default 'inview'.
   */
  trigger?: 'scroll' | 'inview' | 'manual';
  /** Scroll mapping when trigger is 'scroll'. */
  scroll?: ScrollProgressOptions;
  /** Draw-on duration in ms when trigger is 'inview'. Default 700. */
  duration?: number;
  /** After the draw-on, strokes break up and flutter away. Default true. */
  flutterOut?: boolean;
  /**
   * For 'trace': the outline to trace, as points in the target's box space,
   * each 0..1 — lets you draw around a subject inside an image or video.
   */
  path?: readonly (readonly [number, number])[];
}

export interface ScribbleHighlightHandle extends Effect<ScribbleHighlightOptions> {
  /** Drives the draw-on manually, 0..1. Only meaningful with trigger 'manual'. */
  setProgress(progress: number): void;
  /** Replays the draw-on from zero. */
  replay(): void;
}

type Resolved = Required<Omit<ScribbleHighlightOptions, 'scroll' | 'path'>> &
  Pick<ScribbleHighlightOptions, 'scroll' | 'path'>;

interface StrokeTiming {
  /** Where in the 0..1 draw-on this stroke starts appearing. */
  revealStart: number;
  revealSpan: number;
  /** Fraction of the flutter this stroke waits out before it starts leaving. */
  flutterDelay: number;
  driftX: number;
  driftY: number;
  spin: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;

/**
 * `color-interpolation-filters` must be sRGB: the linearRGB default gamma-shifts
 * the roughened edge, which reads as a pale halo around a saturated crayon.
 */
const CRAYON_FILTER = `
  <filter filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
    <feTurbulence
      data-p="turbulence"
      type="fractalNoise"
      baseFrequency="0.07"
      numOctaves="3"
      seed="1"
      result="rough"
    />
    <feDisplacementMap
      data-p="displace"
      in="SourceGraphic"
      in2="rough"
      scale="3"
      xChannelSelector="R"
      yChannelSelector="G"
    />
  </filter>
`;

/** Scroll and manual progress: draw on, hold, then flutter off. */
const DRAW_SHARE = 0.45;
const FLUTTER_START = 0.72;

/** The 'inview' timeline, in multiples of `duration`: draw, hold, then flutter. */
const HOLD_FACTOR = 1.6;
const FLUTTER_FACTOR = 0.9;

const DEFAULTS: Resolved = {
  variant: 'circle',
  color: 'currentColor',
  strokeWidth: 3,
  frames: 6,
  fps: 12,
  jitter: 4,
  passes: 2,
  padding: 10,
  seed: 1,
  texture: 'crayon',
  trigger: 'inview',
  duration: 700,
  flutterOut: true,
  scroll: undefined,
  path: undefined,
};

function resolve(base: Resolved, patch: ScribbleHighlightOptions): Resolved {
  return {
    variant: patch.variant ?? base.variant,
    color: patch.color ?? base.color,
    strokeWidth: patch.strokeWidth ?? base.strokeWidth,
    frames: patch.frames ?? base.frames,
    fps: patch.fps ?? base.fps,
    jitter: patch.jitter ?? base.jitter,
    passes: patch.passes ?? base.passes,
    padding: patch.padding ?? base.padding,
    seed: patch.seed ?? base.seed,
    texture: patch.texture ?? base.texture,
    trigger: patch.trigger ?? base.trigger,
    duration: patch.duration ?? base.duration,
    flutterOut: patch.flutterOut ?? base.flutterOut,
    scroll: patch.scroll ?? base.scroll,
    path: patch.path ?? base.path,
  };
}

/**
 * Passes reveal in sequence — pass 2 starts as pass 1 finishes — and the figures
 * inside one pass overlap, so a multi-stroke drawing (an arrow, a field of
 * sparkles) lands piece by piece instead of all at once.
 */
function buildTimings(strokes: readonly ScribbleStroke[], seed: number): StrokeTiming[] {
  const passCount = strokes[strokes.length - 1].pass + 1;
  const perPass = strokes.length / passCount;
  const passSpan = 1 / passCount;
  const stagger = perPass > 1 ? (passSpan * 0.5) / (perPass - 1) : 0;
  const segment = passSpan - stagger * (perPass - 1);
  const rand = mulberry32((seed * 31 + 7919) >>> 0);

  return strokes.map((stroke, index) => {
    const order = strokes.length > 1 ? index / (strokes.length - 1) : 0;
    const angle = rand() * TAU;
    return {
      revealStart: stroke.pass * passSpan + (index - stroke.pass * perPass) * stagger,
      revealSpan: segment,
      flutterDelay: clamp01(order * 0.34 + rand() * 0.12),
      driftX: Math.cos(angle) * (4 + rand() * 9),
      driftY: -(6 + rand() * 14),
      spin: (rand() - 0.5) * 26,
    };
  });
}

export function createScribbleHighlight(
  target: HTMLElement,
  options: ScribbleHighlightOptions = {},
): ScribbleHighlightHandle {
  let config = resolve(DEFAULTS, options);

  const layer = createLayer(target, 'div', 'scribble-layer');
  layer.setAttribute('aria-hidden', 'true');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'scribble-svg');
  const ink = document.createElementNS(SVG_NS, 'g');
  ink.setAttribute('class', 'scribble-ink');
  svg.appendChild(ink);
  layer.appendChild(svg);

  let filter: FilterHandle | null = null;
  let displaceScale = 3;

  let boxWidth = -1;
  let boxHeight = -1;
  let drawings: SVGPathElement[][] = [];
  let timings: StrokeTiming[] = [];

  let reduced = prefersReducedMotion();
  let visible = false;
  let playing = false;
  let elapsed = 0;
  let progress = 0;
  let drawT = 0;
  let flutterT = 0;

  let shown = -1;
  let paintedDraw = -1;
  let paintedFlutter = -1;

  let stopTick: (() => void) | null = null;
  let stopScroll: (() => void) | null = null;
  let destroyed = false;

  /** Writing a filter primitive invalidates the raster of the whole filtered ink
   *  group, so the displacement is only written when its value has moved. */
  let writtenDisplace = Number.NaN;

  function setDisplace(scale: number): void {
    if (filter === null || scale === writtenDisplace) return;
    writtenDisplace = scale;
    filter.set('displace', { scale });
  }

  function syncFilter(): void {
    const wanted = config.texture === 'crayon';
    if (wanted && filter === null) {
      filter = createFilter(CRAYON_FILTER, 'scribble');
      writtenDisplace = Number.NaN;
    } else if (!wanted && filter !== null) {
      filter.destroy();
      filter = null;
    }
    ink.style.filter = filter === null ? '' : filter.css;
  }

  function layout(): void {
    const padding = Math.max(0, config.padding);
    const width = boxWidth + padding * 2;
    const height = boxHeight + padding * 2;

    svg.style.left = `${-padding}px`;
    svg.style.top = `${-padding}px`;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    ink.style.stroke = config.color;

    if (filter === null) return;
    displaceScale = 1.2 + config.strokeWidth * 0.9;
    // The region is in the overlay's user space and must clear the jitter, the
    // displacement and the flutter drift, or the filter crops the strokes.
    const margin = 32 + config.strokeWidth * 3 + config.jitter * 2;
    filter.element.setAttribute('x', String(-margin));
    filter.element.setAttribute('y', String(-margin));
    filter.element.setAttribute('width', String(width + margin * 2));
    filter.element.setAttribute('height', String(height + margin * 2));
    setDisplace(displaceScale);
  }

  function rebuild(): void {
    const strokes = buildScribbleDrawings({
      width: boxWidth,
      height: boxHeight,
      variant: config.variant,
      padding: config.padding,
      jitter: config.jitter,
      passes: config.passes,
      frames: config.frames,
      seed: config.seed,
      path: config.path,
    });

    drawings = strokes.map((drawing) =>
      drawing.map((stroke) => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'scribble-stroke');
        path.setAttribute('d', stroke.d);
        // Normalising pathLength puts every dash value in 0..1, so the draw-on
        // never has to measure an unrendered path with getTotalLength().
        path.setAttribute('pathLength', '1');
        path.setAttribute('stroke-width', (config.strokeWidth * stroke.widthScale).toFixed(2));
        return path;
      }),
    );
    timings = buildTimings(strokes[0], config.seed);
    shown = -1;
  }

  function updateTimeline(deltaMs: number): void {
    if (config.trigger === 'inview') {
      // The 'inview' clock is autonomous motion, so reduced motion holds it on
      // the finished drawing instead of playing it.
      if (reduced) {
        drawT = 1;
        flutterT = 0;
        return;
      }
      if (playing) elapsed += deltaMs;
      const draw = Math.max(config.duration, 1);
      drawT = clamp01(elapsed / draw);
      flutterT = config.flutterOut
        ? clamp01((elapsed - draw * (1 + HOLD_FACTOR)) / (draw * FLUTTER_FACTOR))
        : 0;
      return;
    }
    // 'scroll' and 'manual' are direct manipulation: they keep mapping progress
    // under reduced motion, and only the boil stops.
    drawT = clamp01(progress / DRAW_SHARE);
    flutterT = config.flutterOut ? clamp01((progress - FLUTTER_START) / (1 - FLUTTER_START)) : 0;
  }

  function paint(boil: number): void {
    const drawing = drawings[boil];
    const swapped = boil !== shown;
    if (!swapped && drawT === paintedDraw && flutterT === paintedFlutter) return;

    if (swapped) {
      ink.replaceChildren(...drawing);
      shown = boil;
      // Re-seeding with the drawing keeps the roughened edge from sitting still
      // while the line underneath it changes.
      filter?.set('turbulence', { seed: boil * 7 + 1 });
    }
    paintedDraw = drawT;
    paintedFlutter = flutterT;

    let peak = 0;
    for (let i = 0; i < drawing.length; i++) {
      const timing = timings[i];
      const path = drawing[i];
      const gone =
        flutterT > 0 ? clamp01((flutterT - timing.flutterDelay) / (1 - timing.flutterDelay)) : 0;
      if (gone > peak) peak = gone;

      if (gone > 0) {
        // Breaking the dash pattern apart is the hand erasing it; a CSS opacity
        // fade on a whole stroke reads as a dissolve instead.
        const broken = gone * gone;
        path.setAttribute(
          'stroke-dasharray',
          `${lerp(1, 0.014, broken).toFixed(4)} ${lerp(0, 0.03, broken).toFixed(4)}`,
        );
        path.setAttribute('stroke-dashoffset', '0');
        path.setAttribute('stroke-opacity', (1 - gone).toFixed(3));
        path.style.transform =
          `translate(${(timing.driftX * gone).toFixed(2)}px, ` +
          `${(timing.driftY * broken).toFixed(2)}px) rotate(${(timing.spin * gone).toFixed(2)}deg)`;
        continue;
      }

      const drawn = easeOutCubic(clamp01((drawT - timing.revealStart) / timing.revealSpan));
      if (drawn >= 1) {
        path.setAttribute('stroke-dasharray', 'none');
      } else {
        path.setAttribute('stroke-dasharray', '1');
        path.setAttribute('stroke-dashoffset', (1 - drawn).toFixed(4));
      }
      path.setAttribute('stroke-opacity', '1');
      path.style.transform = '';
    }

    // `peak` is 0 for the whole draw-on, so this value only actually moves during
    // the flutter. Writing it regardless would re-rasterise the crayon-filtered
    // subtree on every frame of the draw-on for no visual change.
    setDisplace(displaceScale * (1 + peak * 2.4));
  }

  function boilFrame(now: number): number {
    if (reduced) return 0;
    const step = 1000 / Math.max(config.fps, 1);
    // Offsetting by the seed keeps two instances on one page from boiling in
    // lockstep, which would read as a single mechanical flicker.
    return Math.floor((now + ((config.seed * 137) % 997)) / step) % drawings.length;
  }

  function tick(now: number, deltaMs: number): void {
    updateTimeline(deltaMs);
    paint(boilFrame(now));
    if (config.flutterOut && flutterT >= 1) syncActivity();
  }

  function syncActivity(): void {
    const finished = config.flutterOut && flutterT >= 1;
    const wanted = !reduced && visible && !finished && boxWidth >= 0;
    if (wanted && stopTick === null) stopTick = onTick(tick);
    else if (!wanted && stopTick !== null) {
      stopTick();
      stopTick = null;
    }
  }

  /**
   * The single entry point for progress-driven triggers. Recomputing the
   * timeline here is what re-arms the tick after scrubbing back out of a
   * finished flutter, and the trailing paint is what draws the terminal frame:
   * reaching the end of the timeline retires the tick before it can draw it.
   */
  function commitProgress(value: number): void {
    progress = value;
    updateTimeline(0);
    syncActivity();
    // Also the reduced-motion path: no tick ever runs there, so the scrub has
    // to draw its own frame.
    if (stopTick === null && boxWidth >= 0) paint(shown < 0 ? 0 : shown);
  }

  function paintStatic(): void {
    if (boxWidth < 0) return;
    updateTimeline(0);
    paintedDraw = -1;
    paint(0);
  }

  function syncScroll(): void {
    stopScroll?.();
    stopScroll =
      config.trigger === 'scroll'
        ? onScrollProgress(target, commitProgress, config.scroll)
        : null;
  }

  syncFilter();
  syncScroll();

  const stopResize = onResize(target, (width, height) => {
    const nextWidth = Math.round(width);
    const nextHeight = Math.round(height);
    if (nextWidth === boxWidth && nextHeight === boxHeight) return;
    boxWidth = nextWidth;
    boxHeight = nextHeight;
    rebuild();
    layout();
    if (reduced) paintStatic();
    else syncActivity();
  });

  const stopVisible = onVisible(target, (isVisible) => {
    visible = isVisible;
    if (isVisible && config.trigger === 'inview') playing = true;
    syncActivity();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    if (reduced) {
      syncActivity();
      paintStatic();
      return;
    }
    elapsed = 0;
    paintedDraw = -1;
    syncActivity();
  });

  return {
    setOptions(patch: Partial<ScribbleHighlightOptions>): void {
      if (destroyed) return;
      config = resolve(config, patch);
      syncFilter();
      syncScroll();
      if (boxWidth >= 0) {
        rebuild();
        layout();
      }
      paintedDraw = -1;
      paintedFlutter = -1;
      if (reduced) paintStatic();
      else syncActivity();
    },

    setProgress(value: number): void {
      if (destroyed) return;
      commitProgress(clamp01(value));
    },

    replay(): void {
      if (destroyed) return;
      elapsed = 0;
      progress = 0;
      drawT = 0;
      flutterT = 0;
      paintedDraw = -1;
      paintedFlutter = -1;
      playing = config.trigger !== 'inview' || visible;
      if (reduced) paintStatic();
      else syncActivity();
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
      filter?.destroy();
      filter = null;
      layer.remove();
    },
  };
}

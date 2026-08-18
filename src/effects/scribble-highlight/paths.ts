/**
 * Procedural scribble geometry: a box plus options in, SVG path data out. Pure —
 * no DOM, no clock. Each drawing in a set is generated from its own PRNG stream
 * and its own noise field, so cycling the set boils the line instead of reading
 * as one wobbling path.
 */

import { clamp, mulberry32, seededWave } from '../../core/math';

export type ScribbleVariant =
  | 'circle'
  | 'underline'
  | 'box'
  | 'strike'
  | 'arrow'
  | 'star'
  | 'trace';

export interface ScribbleGeometryOptions {
  /** Target box width in px. */
  width: number;
  /** Target box height in px. */
  height: number;
  variant: ScribbleVariant;
  /**
   * Slack around the target box. Emitted coordinates live in a box of
   * `width + padding * 2` by `height + padding * 2`, with the target box itself
   * at `(padding, padding)`.
   */
  padding: number;
  /** Peak deviation of the hand, in px. */
  jitter: number;
  /** Overlapping strokes per drawing. */
  passes: number;
  /** How many independent drawings to generate. */
  frames: number;
  seed: number;
  /** Outline for `trace`, as 0..1 coordinates in the target box. */
  path?: readonly (readonly [number, number])[];
}

export interface ScribbleStroke {
  /** SVG path data. */
  d: string;
  /** Which overlapping pass laid this stroke down; the draw-on reveals pass by pass. */
  pass: number;
  /** Multiplier on the caller's stroke width. */
  widthScale: number;
}

interface Point {
  x: number;
  y: number;
}

/** A base curve before the hand is applied. */
interface Figure {
  /** `t` outside 0..1 overshoots: closed figures wrap, open ones extrapolate. */
  at(t: number): Point;
  closed: boolean;
  length: number;
}

const TAU = Math.PI * 2;

/** One sample per ~9px: smooth after the cubic fit without bloating `d`. */
const SAMPLE_SPACING_PX = 9;
const MIN_SAMPLES = 12;
const MAX_SAMPLES = 220;

/**
 * Wobble wavelengths in px rather than in curve fraction, so a long underline
 * and a short one are drawn by the same hand instead of one being a scaled copy.
 */
const DRIFT_WAVELENGTH_PX = 96;
const GRAIN_WAVELENGTH_PX = 27;
const SPEED_WAVELENGTH_PX = 150;

/** Two decimals is finer than a device pixel and keeps `d` strings short. */
const PRECISION = 100;

/** Half-angle between the two arrowhead barbs, in radians. */
const BARB_ANGLE = 0.62;

/** Tessellation per spline segment for `trace`; corner rounding, not accuracy. */
const SPLINE_STEPS = 10;

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Zero-length input yields a zero vector, which keeps degenerate boxes finite. */
function normalize(x: number, y: number): Point {
  const length = Math.hypot(x, y);
  if (length < 1e-6) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

function ellipseFigure(cx: number, cy: number, rx: number, ry: number): Figure {
  // Ramanujan's ellipse perimeter approximation; well inside a pixel here.
  const length = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  return {
    closed: true,
    length,
    at(t: number): Point {
      const angle = t * TAU;
      return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
    },
  };
}

function quadraticFigure(p0: Point, control: Point, p1: Point): Figure {
  // Mean of the chord and the control legs: within a few percent for gentle bows.
  const length = (distance(p0, p1) + distance(p0, control) + distance(control, p1)) / 2;
  return {
    closed: false,
    length,
    at(t: number): Point {
      const u = 1 - t;
      return {
        x: u * u * p0.x + 2 * u * t * control.x + t * t * p1.x,
        y: u * u * p0.y + 2 * u * t * control.y + t * t * p1.y,
      };
    },
  };
}

function polylineFigure(points: readonly Point[], closed: boolean): Figure {
  const nodes = closed ? [...points, points[0]] : points;
  const arc = new Float64Array(nodes.length);
  for (let i = 1; i < nodes.length; i++) arc[i] = arc[i - 1] + distance(nodes[i - 1], nodes[i]);
  const total = arc[nodes.length - 1];

  /** Extrapolates along the boundary segment when `s` falls outside the run. */
  const locate = (s: number): Point => {
    let lo = 0;
    let hi = nodes.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arc[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = Math.max(arc[hi] - arc[lo], 1e-6);
    const f = (s - arc[lo]) / span;
    return {
      x: nodes[lo].x + (nodes[hi].x - nodes[lo].x) * f,
      y: nodes[lo].y + (nodes[hi].y - nodes[lo].y) * f,
    };
  };

  return {
    closed,
    length: total,
    at(t: number): Point {
      if (total <= 0) return { x: nodes[0].x, y: nodes[0].y };
      const s = t * total;
      return locate(closed ? ((s % total) + total) % total : s);
    },
  };
}

/**
 * Catmull-Rom through the caller's points, tessellated so the arc-length walk
 * sees a smooth loop. Sampling the raw polygon instead leaves the authored
 * corners intact, which reads as a traced outline rather than a drawn one.
 */
function splineFigure(points: readonly Point[], closed: boolean): Figure {
  const count = points.length;
  const segments = closed ? count : count - 1;
  const dense: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const before = points[closed ? (i + count - 1) % count : Math.max(i - 1, 0)];
    const from = points[i];
    const to = points[(i + 1) % count];
    const after = points[closed ? (i + 2) % count : Math.min(i + 2, count - 1)];
    for (let step = 0; step < SPLINE_STEPS; step++) {
      const t = step / SPLINE_STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      dense.push({
        x:
          0.5 *
          (2 * from.x +
            (to.x - before.x) * t +
            (2 * before.x - 5 * from.x + 4 * to.x - after.x) * t2 +
            (-before.x + 3 * from.x - 3 * to.x + after.x) * t3),
        y:
          0.5 *
          (2 * from.y +
            (to.y - before.y) * t +
            (2 * before.y - 5 * from.y + 4 * to.y - after.y) * t2 +
            (-before.y + 3 * from.y - 3 * to.y + after.y) * t3),
      });
    }
  }
  if (!closed) dense.push(points[count - 1]);
  return polylineFigure(dense, closed);
}

function figuresFor(
  options: ScribbleGeometryOptions,
  outerWidth: number,
  outerHeight: number,
  sparkles: number,
  rand: () => number,
): Figure[] {
  const { variant, padding } = options;

  if (variant === 'trace') {
    const path = options.path;
    // Too few points to form an outline: fall through to the ellipse rather
    // than render nothing.
    if (path !== undefined && path.length >= 3) {
      const nodes = path.map(([x, y]) => ({
        x: padding + x * options.width,
        y: padding + y * options.height,
      }));
      return [splineFigure(nodes, true)];
    }
  }

  if (variant === 'underline') {
    const y = padding + options.height + padding * 0.45;
    const sag = Math.min(outerHeight * 0.09, 9);
    return [
      quadraticFigure(
        { x: padding * 0.3, y: y + sag * 0.3 },
        { x: outerWidth * 0.5, y: y + sag },
        { x: outerWidth - padding * 0.3, y: y - sag * 0.25 },
      ),
    ];
  }

  if (variant === 'strike') {
    const y = outerHeight * 0.5;
    const rise = outerHeight * 0.05;
    return [
      quadraticFigure(
        { x: -outerWidth * 0.03, y: y + rise },
        { x: outerWidth * 0.5, y: y + rise * 0.4 },
        { x: outerWidth * 1.03, y: y - rise },
      ),
    ];
  }

  if (variant === 'box') {
    const spur = clamp(Math.min(outerWidth, outerHeight) * 0.09, 4, 15);
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: outerWidth, y: 0 },
      { x: outerWidth, y: outerHeight },
      { x: 0, y: outerHeight },
    ];
    const nodes: Point[] = [];
    for (let i = 0; i < 4; i++) {
      const corner = corners[i];
      const previous = corners[(i + 3) % 4];
      const next = corners[(i + 1) % 4];
      const incoming = normalize(corner.x - previous.x, corner.y - previous.y);
      const outgoing = normalize(next.x - corner.x, next.y - corner.y);
      // Carry past the corner, then cut back behind the next edge. That crossing
      // is what a hand leaves and a plotter never does.
      nodes.push({ x: corner.x + incoming.x * spur, y: corner.y + incoming.y * spur });
      nodes.push({ x: corner.x - outgoing.x * spur, y: corner.y - outgoing.y * spur });
    }
    return [polylineFigure(nodes, true)];
  }

  if (variant === 'arrow') {
    // The shaft runs under the target and hooks up past its far end, so the head
    // lands in the padding band instead of on top of the words it points at.
    const tail: Point = { x: outerWidth * 0.04, y: outerHeight * 0.8 };
    const bow: Point = { x: outerWidth * 0.48, y: outerHeight * 1.02 };
    const tip: Point = { x: outerWidth * 0.99, y: outerHeight * 0.62 };
    // Drawn tail-to-tip so the draw-on lands on the head last.
    const shaft = quadraticFigure(tail, bow, tip);
    const figures: Figure[] = [shaft];
    const heading = normalize(tip.x - bow.x, tip.y - bow.y);
    const reversed = Math.atan2(-heading.y, -heading.x);
    // Sized off the shaft, not the box: a head scaled to a one-line target is
    // too small to read as an arrowhead at all.
    const head = clamp(shaft.length * 0.28, 12, 46);
    for (const side of [1, -1]) {
      const angle = reversed + side * BARB_ANGLE;
      const barb: Point = { x: Math.cos(angle), y: Math.sin(angle) };
      const start: Point = {
        x: tip.x + heading.x * head * 0.16,
        y: tip.y + heading.y * head * 0.16,
      };
      const end: Point = { x: tip.x + barb.x * head, y: tip.y + barb.y * head };
      figures.push(
        quadraticFigure(
          start,
          {
            x: (start.x + end.x) * 0.5 - barb.y * head * 0.2 * side,
            y: (start.y + end.y) * 0.5 + barb.x * head * 0.2 * side,
          },
          end,
        ),
      );
    }
    return figures;
  }

  if (variant === 'star') {
    const cx = outerWidth * 0.5;
    const cy = outerHeight * 0.5;
    const figures: Figure[] = [];
    for (let i = 0; i < sparkles; i++) {
      const angle = (i / sparkles) * TAU + (rand() - 0.5) * 0.8;
      // The ring is wider than tall so sparkles cluster past the ends and above
      // the box instead of landing on the middle of the target.
      const px = cx + Math.cos(angle) * outerWidth * (0.5 + rand() * 0.14);
      const py = cy + Math.sin(angle) * outerHeight * (0.6 + rand() * 0.2);
      const size = clamp(Math.min(outerWidth, outerHeight) * (0.18 + rand() * 0.14), 7, 26);
      const tilt = rand() * TAU;
      const cos = Math.cos(tilt);
      const sin = Math.sin(tilt);
      const place = (x: number, y: number): Point => ({
        x: px + x * cos - y * sin,
        y: py + x * sin + y * cos,
      });
      // Two crossing needles of unequal length read as a four-point sparkle.
      figures.push(
        quadraticFigure(place(0, -size), place(size * 0.18, 0), place(0, size)),
        quadraticFigure(place(-size * 0.5, 0), place(0, size * 0.16), place(size * 0.5, 0)),
      );
    }
    return figures;
  }

  return [ellipseFigure(outerWidth * 0.5, outerHeight * 0.5, outerWidth * 0.5, outerHeight * 0.5)];
}

function format(value: number): string {
  const rounded = Math.round(value * PRECISION) / PRECISION;
  return rounded === 0 ? '0' : String(rounded);
}

/** Catmull-Rom through every sample, converted to cubic Béziers at tension 1. */
function toPathData(points: readonly Point[]): string {
  const last = points.length - 1;
  let d = `M${format(points[0].x)} ${format(points[0].y)}`;
  for (let i = 0; i < last; i++) {
    const before = points[i > 0 ? i - 1 : 0];
    const from = points[i];
    const to = points[i + 1];
    const after = points[i + 2 <= last ? i + 2 : last];
    d += ` C${format(from.x + (to.x - before.x) / 6)} ${format(from.y + (to.y - before.y) / 6)}`;
    d += ` ${format(to.x - (after.x - from.x) / 6)} ${format(to.y - (after.y - from.y) / 6)}`;
    d += ` ${format(to.x)} ${format(to.y)}`;
  }
  return d;
}

function buildStroke(
  figure: Figure,
  pass: number,
  rand: () => number,
  drift: (x: number) => number,
  grain: (x: number) => number,
  jitter: number,
): ScribbleStroke {
  const lead = 0.015 + rand() * 0.05;
  const trail = 0.02 + rand() * 0.07;
  // A closed figure starts at a fresh angle every pass, so two passes overlap
  // instead of tracing each other, and the loop never closes cleanly.
  const start = (figure.closed ? rand() : 0) - lead;
  const span = 1 + lead + trail;
  const amplitude = jitter * (0.68 + rand() * 0.7);
  const bias = (rand() - 0.5) * jitter * 0.9;
  const phase = rand() * 64;
  const widthScale = 0.8 + rand() * 0.45;

  const arc = figure.length * span;
  const samples = Math.round(clamp(arc / SAMPLE_SPACING_PX, MIN_SAMPLES, MAX_SAMPLES));
  const probe = span / (samples * 2);

  const points: Point[] = new Array<Point>(samples);
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const t = start + u * span;
    const here = figure.at(t);
    const ahead = figure.at(t + probe);
    const behind = figure.at(t - probe);
    const tangent = normalize(ahead.x - behind.x, ahead.y - behind.y);
    const s = u * arc;
    const offset =
      bias +
      amplitude *
        (drift(s / DRIFT_WAVELENGTH_PX + phase) * 0.82 +
          grain(s / GRAIN_WAVELENGTH_PX + phase * 1.37) * 0.32);
    // A hand speeds up and slows down, bunching samples along the curve.
    const along = amplitude * 0.5 * drift(s / SPEED_WAVELENGTH_PX + phase + 11.5);
    points[i] = {
      x: here.x - tangent.y * offset + tangent.x * along,
      y: here.y + tangent.x * offset + tangent.y * along,
    };
  }

  return { d: toPathData(points), pass, widthScale };
}

/**
 * Generates `frames` complete, independent drawings. Every drawing carries the
 * same stroke count in the same pass order, so the draw-on schedule holds while
 * the boil cycles between them.
 */
export function buildScribbleDrawings(options: ScribbleGeometryOptions): ScribbleStroke[][] {
  const spec: ScribbleGeometryOptions = {
    ...options,
    width: Math.max(0, options.width),
    height: Math.max(0, options.height),
    padding: Math.max(0, options.padding),
    jitter: Math.max(0, options.jitter),
    passes: Math.max(1, Math.round(options.passes)),
    frames: Math.max(1, Math.round(options.frames)),
  };
  const outerWidth = spec.width + spec.padding * 2;
  const outerHeight = spec.height + spec.padding * 2;
  // Sparkle count is drawn from the base seed, not per frame: a drawing set with
  // uneven stroke counts would reshuffle the draw-on as it boils.
  const sparkles = 4 + Math.floor(mulberry32(spec.seed >>> 0)() * 3);

  const drawings: ScribbleStroke[][] = new Array<ScribbleStroke[]>(spec.frames);
  for (let frame = 0; frame < spec.frames; frame++) {
    const frameSeed = (spec.seed + frame * 977) >>> 0;
    const rand = mulberry32(frameSeed);
    const drift = seededWave(frameSeed);
    const grain = seededWave((frameSeed ^ 0x9e3779b9) >>> 0);
    const figures = figuresFor(spec, outerWidth, outerHeight, sparkles, rand);

    const strokes: ScribbleStroke[] = [];
    for (let pass = 0; pass < spec.passes; pass++) {
      for (const figure of figures) {
        strokes.push(buildStroke(figure, pass, rand, drift, grain, spec.jitter));
      }
    }
    drawings[frame] = strokes;
  }
  return drawings;
}

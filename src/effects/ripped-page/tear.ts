/**
 * Torn-paper geometry: a box plus options in, a tear polyline and the two CSS
 * clip polygons out. Pure and deterministic — the same seed and box always tear
 * the same way, which is what lets a scroll scrub run backwards and forwards
 * over one static clip instead of regenerating geometry per frame.
 *
 * The profile is 1D midpoint displacement rather than smooth noise. A tear in
 * paper is self-similar: every scale of the edge looks like the scale above it,
 * because the fibres fail in bundles. Value noise gives a wobbly line; recursive
 * displacement gives one that reads as fibre.
 */

import { clamp, clamp01, mulberry32 } from '../../core/math';

export type TearAxis = 'horizontal' | 'vertical';
export type TearPivot = 'start' | 'end' | 'center';

export interface TearOptions {
  width: number;
  height: number;
  axis: TearAxis;
  /** Tilt of the tear in degrees, clamped to ±MAX_ANGLE. */
  angle: number;
  /** Where the tear crosses the frame, 0..1 across the axis. */
  offset: number;
  /** Jaggedness, 0..1. */
  roughness: number;
  /** Fibre tufts: how far bundles of paper stick out of the edge, 0..1. */
  fiber: number;
  /** Which end of the tear the pieces hinge on. */
  pivotAt: TearPivot;
  seed: number;
}

export interface TearPoint {
  x: number;
  y: number;
}

export interface TearGeometry {
  /** The tear itself in px, from one frame edge to the other. */
  line: TearPoint[];
  /** `clip-path` polygon for the piece the tear leaves above (or left of) it. */
  leadClip: string;
  /** …and for the piece below (or right of) it. */
  trailClip: string;
  /** `d` for stroking the fibre edge; the same polyline as `line`. */
  edgePath: string;
  /** Rotation origin in px — the end of the tear the pieces hinge on. */
  pivot: TearPoint;
}

/** Past this the tilt runs a tear off the end of the frame before it crosses. */
const MAX_ANGLE = 35;
/** One point per ~6px: fine enough that the fibre reads, short enough to keep the polygon strings small. */
const SPACING_PX = 6;
const MIN_SAMPLES = 24;
const MAX_SAMPLES = 340;
/** Peak displacement as a fraction of the across-axis, at roughness 1. */
const ROUGHNESS_SPAN = 0.11;
/** Amplitude retained per octave. Lower reads as a cut, higher as confetti. */
const PERSISTENCE = 0.56;
/** Longest fibre tuft in px at fiber 1. */
const FIBER_PX = 16;
/** One decimal is finer than a device pixel and halves the polygon string. */
const PRECISION = 10;

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * 1D midpoint displacement over a power-of-two grid, resampled to `samples`.
 * Ends are pinned at zero so the tear meets both frame edges cleanly.
 */
function fractalProfile(samples: number, amplitude: number, random: () => number): Float64Array {
  let span = 1;
  while (span + 1 < samples) span *= 2;

  const grid = new Float64Array(span + 1);
  let step = span;
  let scale = amplitude;

  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < span; i += step) {
      const mid = (grid[i - half] + grid[i + half]) / 2;
      grid[i] = mid + (random() * 2 - 1) * scale;
    }
    step = half;
    scale *= PERSISTENCE;
  }

  const profile = new Float64Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const position = (i / Math.max(samples - 1, 1)) * span;
    const low = Math.floor(position);
    const high = Math.min(low + 1, span);
    const t = position - low;
    profile[i] = grid[low] * (1 - t) + grid[high] * t;
  }
  return profile;
}

function formatPolygon(points: readonly TearPoint[]): string {
  let body = '';
  for (let i = 0; i < points.length; i += 1) {
    body += `${i === 0 ? '' : ','}${round(points[i].x)}px ${round(points[i].y)}px`;
  }
  return `polygon(${body})`;
}

function formatPath(points: readonly TearPoint[]): string {
  let data = '';
  for (let i = 0; i < points.length; i += 1) {
    data += `${i === 0 ? 'M' : 'L'}${round(points[i].x)} ${round(points[i].y)}`;
  }
  return data;
}

export function buildTear(options: TearOptions): TearGeometry {
  const width = Math.max(0, finite(options.width));
  const height = Math.max(0, finite(options.height));
  const vertical = options.axis === 'vertical';
  const along = vertical ? height : width;
  const across = vertical ? width : height;

  const samples = Math.round(clamp(along / SPACING_PX, MIN_SAMPLES, MAX_SAMPLES));
  const random = mulberry32(options.seed * 2246822519 + 0x2f1b);

  const roughness = clamp01(options.roughness);
  const fiber = clamp01(options.fiber);
  const angle = (clamp(options.angle, -MAX_ANGLE, MAX_ANGLE) * Math.PI) / 180;
  const profile = fractalProfile(samples, across * ROUGHNESS_SPAN * roughness, random);

  const base = clamp01(options.offset) * across;
  const tilt = Math.tan(angle) * along;
  // Keeping the whole tear a tuft's width inside the frame stops a clip polygon
  // from degenerating into a slit at one corner.
  const margin = FIBER_PX * fiber + 1;

  const line: TearPoint[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / Math.max(samples - 1, 1);
    let value = base + (t - 0.5) * tilt + profile[i];

    // Tufts: a bundle of fibres that let go late, so they stand out of the edge
    // on the lead side and leave a matching notch on the trail side.
    if (fiber > 0 && i > 0 && i < samples - 1 && random() < 0.16) {
      value -= FIBER_PX * fiber * (0.35 + random() * 0.65);
    }

    value = clamp(value, margin, Math.max(margin, across - margin));
    const position = t * along;
    line.push(
      vertical ? { x: finite(value), y: finite(position) } : { x: finite(position), y: finite(value) },
    );
  }

  const first = line[0];
  const last = line[line.length - 1];
  const reversed = line.slice().reverse();

  const lead = vertical
    ? [{ x: 0, y: 0 }, ...line, { x: 0, y: height }]
    : [{ x: 0, y: 0 }, { x: width, y: 0 }, ...reversed];
  const trail = vertical
    ? [{ x: width, y: 0 }, ...line, { x: width, y: height }]
    : [...line, { x: width, y: height }, { x: 0, y: height }];

  const pivot =
    options.pivotAt === 'end' ? last : options.pivotAt === 'center' ? line[Math.floor(line.length / 2)] : first;

  return {
    line,
    leadClip: formatPolygon(lead),
    trailClip: formatPolygon(trail),
    edgePath: formatPath(line),
    pivot: { x: round(pivot.x), y: round(pivot.y) },
  };
}

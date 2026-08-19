/**
 * The disc field, as a pure function of (seed, identity, progress, time).
 * Nothing accumulates: scrolling back up reconstructs the same frame it drew on
 * the way down, and neither renderer keeps simulation state between frames.
 *
 * Placement is content-derived when the caller passes anchors — one disc per
 * detected specular highlight, carrying that highlight's colour and brightness.
 * An anchored disc barely travels: a lamp does not slide across the frame
 * because the reader scrolled, so parallax is scaled down by how anchored a disc
 * is, and the shimmer carries the scroll response instead.
 */

import { clamp, clamp01, lerp, mulberry32 } from '../../core/math';
import type { Highlight } from './highlights';

export interface DiscFieldOptions {
  count: number;
  /** Base diameter as a fraction of the host's short side. */
  size: number;
  /** Diameter spread, 0..1. */
  variance: number;
  /** Palette length, so every disc picks a valid tint index. */
  tints: number;
  seed: number;
  /** Detected highlights in host-normalised coordinates. Empty means a free field. */
  anchors: readonly Highlight[];
  /** How strongly discs snap onto those highlights, 0..1. */
  follow: number;
  /** Take each disc's colour from its highlight rather than from the palette. */
  tintFromSource: boolean;
}

export interface DiscStateOptions {
  width: number;
  height: number;
  intensity: number;
  shimmer: number;
  /** Twinkles per disc across the whole scroll range. */
  shimmerRate: number;
  /** Vertical travel across the scroll range, in host heights. */
  parallax: number;
  /** Sway and shimmer-crawl speed in cycles per second; the only time-driven term. */
  drift: number;
}

export interface BokehDisc {
  identity: number;
  /** Home position, 0..1 of the host box. */
  x: number;
  y: number;
  /** Diameter as a fraction of the host's short side. */
  size: number;
  /** 0 far — small, brighter, barely moves; 1 near — large, dimmer, travels most. */
  depth: number;
  tint: number;
  /** 0..1 — how tied this disc is to a highlight. Anchored discs barely travel. */
  anchored: number;
  /** Brightness weight inherited from that highlight. */
  gain: number;
  /** Colour sampled from the source, 0..255, or null to use the palette tint. */
  color: readonly [number, number, number] | null;
  /** Shimmer phase offset, 0..1. */
  phase: number;
  /** Per-disc shimmer rate multiplier, so the field never pulses in unison. */
  rate: number;
  /** Sway amplitude as a fraction of the disc's own diameter. */
  swayX: number;
  swayY: number;
  swayPhase: number;
}

export interface BokehDiscState {
  /** Centre in host-relative CSS px. */
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

const TAU = Math.PI * 2;
/** Enough for a dense field at 4K; past this the CSS renderer is the bottleneck, not the look. */
const MAX_DISCS = 64;
/** Fraction of the travel band each disc fades across as it enters and leaves. */
const FADE_BAND = 0.12;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Positive modulo: JS `%` keeps the sign of the dividend, which unwraps the field. */
function wrapUnit(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

export function createDiscs(options: DiscFieldOptions): BokehDisc[] {
  const count = Math.round(clamp(options.count, 0, MAX_DISCS));
  const tints = Math.max(1, Math.round(options.tints));
  const variance = clamp01(options.variance);
  const follow = clamp01(options.follow);
  const anchors = options.anchors;
  const random = mulberry32(options.seed * 2654435761 + 0x9e37);

  const discs: BokehDisc[] = [];
  for (let i = 0; i < count; i += 1) {
    const depth = random();
    // Near discs read as bigger and softer; the size spread is on top of that,
    // so `variance` never flattens the depth ordering.
    const spread = 1 + variance * (random() * 2 - 1);
    const freeX = random();
    const freeY = random();
    const jitterX = random() * 2 - 1;
    const jitterY = random() * 2 - 1;

    // `follow` is the share of the field that snaps to a highlight, taken from
    // the far planes first: the nearest discs stay free, which is exactly where
    // foreground bokeh comes from — lights outside the frame, not in it. An
    // anchored disc sits *on* its highlight rather than partway toward it;
    // partial placement would only put it somewhere nothing is happening.
    const anchor = anchors.length > 0 && depth < follow ? anchors[i % anchors.length] : null;
    const repeat = anchor === null ? 0 : Math.floor(i / anchors.length);
    // Reused highlights hold their disc less firmly, so a cluster breathes.
    const anchored = anchor === null ? 0 : lerp(1, 0.6, clamp01(repeat / 3));
    const size = Math.max(0, finite(options.size) * lerp(0.7, 1.4, depth) * spread);
    const cluster = repeat === 0 ? 0 : size * 0.5 * repeat;

    discs.push({
      identity: i,
      x: finite(lerp(freeX, (anchor?.x ?? freeX) + jitterX * cluster, anchored)),
      y: finite(lerp(freeY, (anchor?.y ?? freeY) + jitterY * cluster, anchored)),
      size,
      depth,
      tint: Math.floor(random() * tints) % tints,
      anchored,
      // A dim highlight makes a dimmer disc — but a disc *replaces* the point it
      // came from at many times its area, so the floor stays high enough to read.
      gain: anchor === null ? 1 : lerp(0.62, 1, clamp01(anchor.weight)),
      color: anchor !== null && options.tintFromSource ? anchor.color : null,
      phase: random(),
      rate: lerp(0.55, 1.9, random()),
      swayX: lerp(0.04, 0.22, random()),
      swayY: lerp(0.03, 0.16, random()),
      swayPhase: random(),
    });
  }
  return discs;
}

/**
 * `progress` is scroll position, `time` elapsed seconds. Reduced motion freezes
 * `time` and keeps passing live `progress` — the shimmer stays scroll-reactive
 * while the autonomous sway stops.
 */
export function discState(
  disc: BokehDisc,
  progress: number,
  time: number,
  options: DiscStateOptions,
): BokehDiscState {
  const short = Math.min(options.width, options.height);
  const diameter = disc.size * short;

  // Travel is scaled by depth and cut by how anchored the disc is; the wrap span
  // is one host height plus one diameter, so a travelling disc has left the box
  // completely before it re-enters.
  const span = 1 + disc.size;
  const mobility = (1 - disc.anchored * 0.88) * lerp(0.35, 1.25, disc.depth);
  const travel = progress * options.parallax * mobility;
  const band = wrapUnit(disc.y - travel);
  const x = finite(disc.x * options.width);
  // The travel band stretches by one diameter so a moving disc clears the box;
  // an anchored disc must land exactly on its highlight instead, so the two
  // mappings are blended by the same factor that holds it still.
  const y = finite(lerp(band * span - disc.size * 0.5, disc.y, disc.anchored) * options.height);

  // Sway is measured against its own value at time zero, so a frozen or
  // drift-free field sits exactly where it was placed — an anchored disc must
  // not be nudged off its highlight by a phase offset.
  const swayRate = options.drift * lerp(0.6, 1.4, disc.depth);
  const swayAngle = TAU * (time * swayRate + disc.swayPhase);
  const restAngle = TAU * disc.swayPhase;
  const sway = {
    x: (Math.sin(swayAngle) - Math.sin(restAngle)) * disc.swayX * diameter,
    y: (Math.cos(swayAngle * 0.78) - Math.cos(restAngle * 0.78)) * disc.swayY * diameter,
  };

  // Scroll drives the shimmer phase; time only crawls it, so a still page
  // glimmers gently and a scrolling one sparkles.
  const phase = disc.phase + progress * options.shimmerRate * disc.rate + time * options.drift * 0.4;
  const wave = 0.5 + 0.5 * Math.sin(TAU * phase);
  // Squared, because an out-of-focus highlight spends most of its cycle dim and
  // spikes briefly — a plain sine reads as a slow breath, not a shimmer.
  const peak = wave * wave;
  const shimmer = clamp01(options.shimmer);
  const brightness = 1 - shimmer * 0.8 + shimmer * 0.8 * peak * 1.6;

  // Both ends of the travel band, so wrap-around never pops a disc into view.
  // An anchored disc sits still, and a still disc must not be faded by a band it
  // never crosses.
  const crossing = clamp01(Math.min(band, 1 - band) / FADE_BAND);
  const fade = lerp(crossing, 1, disc.anchored);
  const depthDim = lerp(1, 0.55, disc.depth);

  return {
    x: x + finite(sway.x),
    y: y + finite(sway.y),
    scale: 1 + 0.14 * shimmer * (peak - 0.5),
    opacity: clamp01(finite(options.intensity * disc.gain * depthDim * brightness * fade)),
  };
}

/**
 * Wiggle scheduling and filter geometry, as pure functions.
 *
 * Nothing here knows about fonts, glyphs, words or text metrics - that is the
 * whole point of the effect. The wiggle is a displacement of whatever pixels
 * the host already painted, so it applies equally to a heading, an emoji, an
 * icon font, a Devanagari paragraph or a `<sup>` in the middle of a line.
 */

/** How many displacement fields a cycle can hold. Above this a boil reads as noise. */
export const MAX_FRAMES = 12;

export interface WiggleFrame {
  /** `feTurbulence` seed for this frame of the cycle. */
  seed: number;
}

/**
 * A hand-drawn boil is a *short cycle* of drawings, not a new random field every
 * step: three or four fields repeating is what reads as a human redrawing the
 * same line, while an endless sequence of fresh seeds reads as TV static. The
 * seeds are spread rather than consecutive because neighbouring `feTurbulence`
 * seeds produce visibly similar fields in every engine.
 */
export function wiggleFrames(count: number, seed: number): WiggleFrame[] {
  const total = Math.max(1, Math.min(MAX_FRAMES, Math.round(count)));
  const base = Math.round(seed);
  const frames: WiggleFrame[] = [];
  for (let i = 0; i < total; i += 1) frames.push({ seed: base + i * 37 });
  return frames;
}

/**
 * Which frame of the cycle `elapsed` ms lands on. A cycle runs forward and
 * wraps: ping-ponging retraces the same fields backwards, which reads as a
 * mechanical shuttle rather than as redrawing.
 */
export function frameIndex(elapsedMs: number, stepMs: number, count: number): number {
  const total = Math.max(1, Math.round(count));
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(stepMs) || stepMs <= 0) return 0;
  const step = Math.floor(elapsedMs / stepMs);
  return ((step % total) + total) % total;
}

/**
 * `feDisplacementMap` moves a pixel by `scale * (channel - 0.5)`, so a channel
 * spanning 0..1 gives a peak excursion of half the scale in each direction.
 * Amplitude is specified as that peak excursion in px, which is the number a
 * caller can reason about against a font size.
 */
export function displacementScale(amplitudePx: number): number {
  return Math.max(0, amplitudePx) * 2;
}

/** `baseFrequency` is cycles per px, so a wavelength in px inverts to it directly. */
export function baseFrequency(wavelengthPx: number): number {
  return 1 / Math.max(4, wavelengthPx);
}

/** 1..4 octaves. More octaves add fine chatter on top of the main wobble. */
export function octaveCount(roughness: number): number {
  const clamped = Math.max(0, Math.min(1, roughness));
  return 1 + Math.round(clamped * 3);
}

export interface FilterRegion {
  x: string;
  y: string;
  width: string;
  height: string;
}

export interface EdgeReconstruction {
  /** `feGaussianBlur` stdDeviation, in px. */
  blur: number;
  /** `feFuncA` slope. */
  slope: number;
  /** `feFuncA` intercept, centred so the 50% alpha crossing does not move. */
  intercept: number;
}

/**
 * Blur-then-steepen amounts for rebuilding an antialiased edge after displacement.
 *
 * The intercept is `(1 - slope) / 2` rather than a tuned number: that is the value
 * that fixes the ramp about alpha 0.5, so the reconstruction sharpens the edge
 * without moving it. Any other intercept fattens or thins every stroke, which on
 * text reads as the wrong font weight.
 */
export function edgeReconstruction(crisp: number): EdgeReconstruction {
  const amount = Math.max(0, Math.min(1, crisp));
  // Measured against a 64px headline at a device pixel ratio of 1: half a pixel of
  // blur leaves the streaks the displacement fetch produces along near-horizontal
  // edges, and about a pixel removes them without visibly rounding a terminal.
  const slope = 1 + amount * 6;
  return { blur: amount * 1.1, slope, intercept: (1 - slope) / 2 };
}

/**
 * Displacement pushes pixels outside the element's box, and anything outside the
 * filter region is clipped - a wiggle that clips reads as text sliced off by a
 * ruler, which is worse than no wiggle at all.
 *
 * The region is expressed in percentages of the bounding box because that is what
 * `<filter>` takes by default, so the padding has to be recomputed from the box's
 * pixel size: 3px of slack is a rounding error on a paragraph and a quarter of a
 * one-line label. The floor exists because a zero-height inline box would
 * otherwise get a zero-height region and vanish entirely.
 */
export function filterRegion(amplitudePx: number, width: number, height: number): FilterRegion {
  // Room for the excursion, the outermost octave riding on it, and antialiasing.
  const slack = Math.max(2, displacementScale(amplitudePx) * 0.75 + 2);
  const padX = Math.min(50, Math.max(2, (slack / Math.max(1, width)) * 100));
  const padY = Math.min(50, Math.max(2, (slack / Math.max(1, height)) * 100));
  return {
    x: `${-padX.toFixed(2)}%`,
    y: `${-padY.toFixed(2)}%`,
    width: `${(100 + padX * 2).toFixed(2)}%`,
    height: `${(100 + padY * 2).toFixed(2)}%`,
  };
}

/**
 * Puts the wiggle after whatever the host already had, so the host's own filter
 * runs first and the wiggle displaces its result.
 *
 * `none` is the initial value of `filter`, not a filter function, so it cannot
 * appear in a list: `none url(#id)` is invalid and drops the whole declaration,
 * which silently removes the wiggle rather than merely ignoring the `none`.
 */
export function composeFilter(hostFilter: string, wiggle: string): string {
  const base = hostFilter.trim();
  if (base === '' || base === 'none') return wiggle;
  return `${base} ${wiggle}`;
}

/**
 * The leak's geometry and staging: which edge it enters from, where the sweep
 * bands sit, and how every layer's strength maps from progress. Both renderers
 * read this file, so the CSS and the WebGL path cannot drift apart.
 */

import { clamp01, lerp, mulberry32, smoothstep } from '../../core/math';
import type { LeakConfig, LeakDirection } from './index';

export type CardinalLeakDirection = Exclude<LeakDirection, 'random'>;

export interface SweepBandGeometry {
  angle: number;
  offset: number;
  scale: number;
  speed: number;
  width: number;
}

/**
 * Per-frame strengths and placement, in the units the stylesheet uses: opacities
 * 0..1, offsets in percent of the leak box on screen axes with y downward, angle
 * in degrees. The WebGL renderer converts; the CSS renderer writes them out.
 */
export interface LeakStage {
  fromOpacity: number;
  exposure: number;
  /** Leak group opacity before flare flicker. */
  leakOpacity: number;
  coreOpacity: number;
  halationOpacity: number;
  grainOpacity: number;
  offsetX: number;
  offsetY: number;
  angle: number;
  scale: number;
  /** True when the leak travels along x, which is the axis the bands follow. */
  horizontal: boolean;
}

const DIRECTIONS: readonly CardinalLeakDirection[] = ['left', 'right', 'top', 'bottom'];

/** Flare flicker resamples this often; anything faster reads as digital noise. */
const FLICKER_FPS = 18;

export function resolveLeakDirection(
  direction: LeakDirection,
  seed: number,
): CardinalLeakDirection {
  if (direction !== 'random') return direction;
  const random = mulberry32(seed);
  return DIRECTIONS[Math.floor(random() * DIRECTIONS.length)] as CardinalLeakDirection;
}

export function buildSweepBands(seed: number): SweepBandGeometry[] {
  const random = mulberry32(seed ^ 0x51f15e);
  return Array.from({ length: 3 }, (_, index) => ({
    angle: -10 + random() * 20,
    offset: (index - 1) * 22 + (random() - 0.5) * 10,
    scale: 0.86 + random() * 0.36,
    speed: 0.82 + index * 0.15 + random() * 0.08,
    width: 22 + random() * 18,
  }));
}

/** A renderer keeps one of these and has `computeLeakStage` write into it. */
export function createLeakStage(): LeakStage {
  return {
    fromOpacity: 1,
    exposure: 0,
    leakOpacity: 0,
    coreOpacity: 0,
    halationOpacity: 0,
    grainOpacity: 0,
    offsetX: 0,
    offsetY: 0,
    angle: 0,
    scale: 1,
    horizontal: true,
  };
}

/** Writes the stage for `progress` into `out`. Runs per scrubbed frame, so it allocates nothing. */
export function computeLeakStage(config: LeakConfig, progress: number, out: LeakStage): void {
  const p = clamp01(progress);
  const peak = smoothstep(0, 1, 1 - Math.abs(p * 2 - 1));
  // Holds grain off the first and last few percent, so both ends are clean shots.
  const endpointGate = smoothstep(0, 0.08, p) * (1 - smoothstep(0.92, 1, p));
  const intensity = clamp01(config.intensity);
  const bloom = clamp01(config.bloom);
  const halation = clamp01(config.halation);
  const travel = lerp(-58, 58, p);

  if (config.style === 'flash') {
    out.fromOpacity = 1 - smoothstep(0.48, 0.55, p);
    out.exposure = peak * bloom * intensity;
    out.leakOpacity = peak * intensity;
    out.coreOpacity = peak * bloom * intensity;
    out.halationOpacity = peak * halation * intensity * (1 - smoothstep(0.5, 0.7, p));
    out.scale = 0.78 + peak * 0.58;
  } else {
    const sweepPeak =
      p === 0 || p === 1 ? 0 : Math.pow(Math.max(0, Math.sin(Math.PI * p)), 0.72);
    out.fromOpacity = 1 - smoothstep(0.12, 0.88, p);
    out.exposure = 0;
    out.leakOpacity = sweepPeak * intensity * 0.72;
    out.coreOpacity = sweepPeak * bloom * intensity * 0.3;
    out.halationOpacity = sweepPeak * halation * intensity * out.fromOpacity * 0.34;
    out.scale = 1;
  }
  out.grainOpacity = clamp01(config.grain) * endpointGate * 0.32;

  switch (config.direction) {
    case 'left':
      out.offsetX = travel;
      out.offsetY = 0;
      out.angle = 0;
      break;
    case 'right':
      out.offsetX = -travel;
      out.offsetY = 0;
      out.angle = 180;
      break;
    case 'top':
      out.offsetX = 0;
      out.offsetY = travel;
      out.angle = 90;
      break;
    case 'bottom':
      out.offsetX = 0;
      out.offsetY = -travel;
      out.angle = -90;
      break;
  }
  out.horizontal = config.direction === 'left' || config.direction === 'right';
}

/** Writes one band's placement — x%, y%, angle in degrees — at `offset` in `out`. */
export function sweepBandPlacement(
  geometry: SweepBandGeometry,
  stage: LeakStage,
  out: Float32Array,
  offset: number,
): void {
  const along = (stage.horizontal ? stage.offsetX : stage.offsetY) * geometry.speed;
  out[offset] = stage.horizontal ? along : geometry.offset;
  out[offset + 1] = stage.horizontal ? geometry.offset : along;
  out[offset + 2] = stage.angle + geometry.angle;
}

/** Stepped flare flicker, 0.95..1.03. Freezing `elapsedMs` holds it still. */
export function leakFlicker(elapsedMs: number, seed: number): number {
  const stepped = Math.floor((elapsedMs / 1000) * FLICKER_FPS);
  const noise = Math.sin(stepped * 12.9898 + seed * 78.233) * 43758.5453;
  return 0.95 + (noise - Math.floor(noise)) * 0.08;
}

/** Slow autonomous drift of the leak body, in CSS pixels, written into `out`. */
export function leakDrift(elapsedMs: number, seed: number, out: Float32Array): void {
  const phase = elapsedMs / 1000;
  out[0] = Math.sin(phase * 0.42 + seed) * 5;
  out[1] = Math.cos(phase * 0.35 + seed * 0.7) * 4;
}

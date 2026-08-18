/**
 * Everything one held frame of film carries besides the picture: exposure
 * flicker, gate weave, the projector's flash, rolling shutter band and colour
 * breathing, and the print's dust and scratches.
 *
 * Both renderers read this state instead of deriving their own, so a WebGL
 * frame and a Canvas/SVG frame at the same held index carry the same
 * instability. Every value comes from the frame index, which is why holding the
 * index still — reduced motion, or an off-screen host — freezes the whole lot
 * on one representative frame.
 */

import { mulberry32, seededWave } from '../../core/math';
import type { FilmstockConfig } from './index';

/** Specks the dust field can hold; `dust` scales how many of them show. */
export const DUST_SPECKS = 32;

/** Side of the square viewBox dust is placed in, stretched to the host box. */
export const DUST_VIEWBOX = 1000;

const weaveX = seededWave(0x35a1);
const weaveY = seededWave(0xc9e7);
const weaveRotation = seededWave(0x811d);
const colorBreathingWave = seededWave(0x4f1bbcdc);

export interface FrameState {
  /** Held-frame index. The grain field is re-seeded from it. */
  frame: number;
  /** Per-frame exposure multiplier over the graded frame. */
  exposure: number;
  /** Gate drift in CSS px and degrees, in CSS axes: y grows downward. */
  weaveX: number;
  weaveY: number;
  weaveRotation: number;
  /** Rolling shutter band: opacity, plus top edge and height in CSS px. */
  bandOpacity: number;
  bandY: number;
  bandHeight: number;
  /** Dye instability; only one of the two is ever above zero. */
  warmBreathing: number;
  coolBreathing: number;
  flashOpacity: number;
  /** A bright flash screens warm white; a dark one multiplies near-black. */
  flashBright: boolean;
  /** Four values per speck — x, y, radius, opacity — in viewBox units. */
  specks: Float32Array;
  speckCount: number;
  /** x, y, width, height in viewBox units; meaningless while opacity is 0. */
  scratch: Float32Array;
  scratchOpacity: number;
}

/** One state object per effect, rewritten in place: 16 of these a second. */
export function createFrameState(): FrameState {
  return {
    frame: 0,
    exposure: 1,
    weaveX: 0,
    weaveY: 0,
    weaveRotation: 0,
    bandOpacity: 0,
    bandY: 0,
    bandHeight: 0,
    warmBreathing: 0,
    coolBreathing: 0,
    flashOpacity: 0,
    flashBright: false,
    specks: new Float32Array(DUST_SPECKS * 4),
    speckCount: 0,
    scratch: new Float32Array(4),
    scratchOpacity: 0,
  };
}

function clearProjector(state: FrameState): void {
  state.bandOpacity = 0;
  state.bandY = 0;
  state.bandHeight = 0;
  state.warmBreathing = 0;
  state.coolBreathing = 0;
  state.flashOpacity = 0;
}

/**
 * Projector artefacts run on their own clock — events per second rather than per
 * held frame — and on their own PRNG stream, so changing the dust density cannot
 * move a flash.
 */
function updateProjector(
  state: FrameState,
  frame: number,
  config: FilmstockConfig,
  height: number,
  reduced: boolean,
): void {
  if (reduced || config.flickerStyle === 'exposure') {
    clearProjector(state);
    return;
  }

  const time = frame / config.fps;
  const styleScale = config.flickerStyle === 'mixed' ? 0.75 : 1;

  state.bandHeight = height * 0.55;
  const bandPhase = (time * 0.32 + 0.17) % 1;
  state.bandY = bandPhase * (height + state.bandHeight) - state.bandHeight;
  state.bandOpacity = config.shutterBand * styleScale;

  const breathing = colorBreathingWave(time * 0.55 + 11.2);
  const breathingOpacity = Math.abs(breathing) * config.colorBreathing * styleScale * 0.18;
  state.warmBreathing = breathing > 0 ? breathingOpacity : 0;
  state.coolBreathing = breathing < 0 ? breathingOpacity : 0;

  const projectorRandom = mulberry32((frame * 0x85ebca6b + 0xc2b2ae35) >>> 0);
  // Poisson: the chance at least one event lands inside this frame's slice.
  const eventChance = 1 - Math.exp(-config.flickerRate / config.fps);
  if (projectorRandom() >= eventChance || config.flash <= 0) {
    state.flashOpacity = 0;
    return;
  }

  state.flashBright = projectorRandom() < 0.68;
  state.flashOpacity = config.flash * styleScale * (0.18 + projectorRandom() * 0.32);
}

function updateDust(state: FrameState, config: FilmstockConfig, random: () => number): void {
  const visibleSpecks = Math.round(config.dust * DUST_SPECKS);
  for (let i = 0; i < visibleSpecks; i += 1) {
    const slot = i * 4;
    state.specks[slot] = random() * DUST_VIEWBOX;
    state.specks[slot + 1] = random() * DUST_VIEWBOX;
    state.specks[slot + 2] = 0.7 + random() * 3.6;
    state.specks[slot + 3] = 0.18 + random() * 0.58;
  }
  state.speckCount = visibleSpecks;

  if (!(config.dust > 0.25) || random() >= config.dust * 0.28) {
    state.scratchOpacity = 0;
    return;
  }
  state.scratch[0] = random() * DUST_VIEWBOX;
  state.scratch[1] = random() * 220 - 80;
  state.scratch[2] = 0.4 + random() * 1.3;
  state.scratch[3] = 700 + random() * 420;
  state.scratchOpacity = 0.1 + random() * 0.34;
}

/**
 * Rewrites `state` for one held frame. Exposure, weave and dust share a single
 * PRNG stream seeded from the frame index: the draw order is the state's
 * identity, so a frame re-rendered after a resize comes back the same.
 */
export function updateFrameState(
  state: FrameState,
  frame: number,
  config: FilmstockConfig,
  width: number,
  height: number,
  reduced: boolean,
): void {
  state.frame = frame;

  const random = mulberry32((frame * 0x9e3779b1 + 0x51f15e) >>> 0);
  const exposureScale =
    config.flickerStyle === 'exposure' ? 1 : config.flickerStyle === 'mixed' ? 0.65 : 0.2;
  state.exposure = reduced ? 1 : 1 + (random() - 0.5) * config.flicker * exposureScale * 0.15;

  updateProjector(state, frame, config, height, reduced);

  if (reduced) {
    state.weaveX = 0;
    state.weaveY = 0;
    state.weaveRotation = 0;
  } else {
    const time = frame * 0.27;
    const range = Math.min(width, height) * 0.006 * config.gateWeave;
    const gateJump = random() < 0.035 ? (random() - 0.5) * range * 4.8 : 0;
    state.weaveX = weaveX(time) * range + gateJump;
    state.weaveY = weaveY(time + 19.4) * range * 0.7;
    state.weaveRotation = weaveRotation(time + 53.7) * config.gateWeave * 0.12;
  }

  updateDust(state, config, random);
}

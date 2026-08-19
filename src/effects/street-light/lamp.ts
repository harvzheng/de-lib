/**
 * Street-lamp geometry, as pure functions.
 *
 * The lamp is a fixture in the scene, not a light that sweeps. Its lens holds a
 * fixed line in the *viewport* and the host scrolls past underneath, so a given
 * paragraph or photograph is dark, then lit as it passes under the lamp, then
 * dark again. That inverts where the work happens: everything the light is made
 * of — pool, hotspot, run-out tail, mist cone, the fixture itself — is laid out
 * once, in the coordinates of a band that is pinned to the viewport
 * (`lampRig`), and scroll only slides that band along the host (`bandOffset`).
 *
 * The reason for that split is performance, and it is the whole design. A pool
 * that moved through the host would have to re-author four host-sized gradient
 * layers at every scroll step; a band that is pinned to the viewport paints its
 * gradients once and then only translates, which is a composite rather than a
 * repaint. Keep any progress-dependent quantity out of `lampRig`.
 *
 * The pool is described as axis-aligned ellipses in band pixels because that is
 * what a CSS radial gradient can express. It costs nothing here: a lamp
 * overhead throws straight down the page, which is the axis a gradient already
 * runs along.
 */

import { clamp, clamp01 } from '../../core/math';

const DEGREES_PER_RADIAN = 180 / Math.PI;

/**
 * Slack above and below the viewport, as a fraction of viewport height. The
 * scroll inversion aligns the band with the viewport exactly, so it only needs
 * enough excess for the configured sway not to expose an edge. A large margin
 * rasterises transparent and fully-dark pixels that can never be seen; 6% is
 * 48px at an 800px viewport, beyond the demo control's 40px maximum sway.
 */
const BAND_MARGIN = 0.06;

/** The wire pivots above the head, so the pool at the far end of the throw swings further than the head. */
const POOL_SWAY_GAIN = 1.9;

export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned ellipse in band px: `across` is the x radius, `along` the y radius. */
export interface Ellipse extends Point {
  across: number;
  along: number;
}

export interface RigInput {
  /** Host content-box width in px. */
  width: number;
  /** Viewport height in px. */
  viewportHeight: number;
  /** Viewport fraction the lens holds. */
  anchor: number;
  /** Host-x fraction the lamp stands at. */
  column: number;
  /** How far below the lens the pool centre lands, as a fraction of viewport height. */
  drop: number;
  /** Pool x radius as a fraction of the lesser of host width and viewport height. */
  spread: number;
  /** Pool y radius over x radius; floored at 1 so the throw is never squat. */
  stretch: number;
}

/** The hardware: a mast, an arm reaching off it, and the head on the end. */
export interface Fixture {
  /** -1 puts the mast to the left of the head, +1 to the right. */
  side: -1 | 1;
  /** Head centre to mast centre, in px. */
  armLength: number;
  armThickness: number;
  mastThickness: number;
  headWidth: number;
  headHeight: number;
}

/** Rectangle in band px. Layers are sized to these so nothing rasterises area it never paints. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LampRig {
  /** Band height in px: the viewport plus `BAND_MARGIN` of slack either side. */
  height: number;
  /** Lens position in band coordinates — where the light leaves the fixture. */
  lensX: number;
  lensY: number;
  fixture: Fixture;
  fixtureBox: Box;
  /** Bright core of the throw, just below the lens. */
  hotspot: Ellipse;
  pool: Ellipse;
  /** Long dim run-out past the pool; also the envelope the night opens to. */
  tail: Ellipse;
  /**
   * Everything the throw's own gradients reach. The `screen` and `overlay` layers
   * are sized to this rather than to the band, because outside it they are
   * transparent and a transparent pixel still costs a rasterised one.
   */
  throwBox: Box;
  /** The mist's box, with the lens exactly at its top centre. */
  coneBox: Box;
  /** Half-angle of the mist cone in degrees, measured off straight down. */
  coneHalfAngle: number;
  /** How far the mist carries from the lens, in px. */
  coneLength: number;
}

/**
 * Everything the lamp paints, in the coordinates of the viewport-pinned band.
 * Nothing here depends on scroll position, which is what lets `index.ts` write
 * it into custom properties on option and resize changes only.
 */
export function lampRig(input: RigInput): LampRig {
  const width = Math.max(0, input.width);
  const viewportHeight = Math.max(0, input.viewportHeight);
  const column = clamp01(input.column);

  const lensX = column * width;
  const lensY = (BAND_MARGIN + clamp01(input.anchor)) * viewportHeight;
  const drop = Math.max(0, input.drop) * viewportHeight;

  // The lesser of the two, not the width: a pool sized off host width alone
  // runs off a wide host's frame and shrinks to a spot on a narrow one, and the
  // same `spread` should read as the same size of pool in both.
  const across = Math.max(0, input.spread) * Math.min(width, viewportHeight);
  const along = across * Math.max(1, input.stretch);
  const poolY = lensY + drop;

  // Fixture size follows the viewport, not the host: the lamp is furniture in
  // the reader's frame, so a host twice as tall must not get a lamp twice as
  const unit = clamp(viewportHeight * 0.055, 22, 58);
  const headHeight = unit * 0.66;
  const fixture: Fixture = {
    // The mast stands on the side the lamp is already nearer, so the arm
    // reaches in over the content rather than out of the frame.
    side: column <= 0.5 ? -1 : 1,
    armLength: unit * 2.6,
    armThickness: Math.max(3, unit * 0.18),
    mastThickness: Math.max(5, unit * 0.3),
    headWidth: unit * 1.8,
    headHeight,
  };

  const armLeft = fixture.side < 0 ? lensX - fixture.armLength : lensX;
  const mastLeft =
    lensX + fixture.side * fixture.armLength - fixture.mastThickness * 0.5;
  const fixtureLeft = Math.min(armLeft, mastLeft, lensX - fixture.headWidth * 0.5);
  const fixtureRight = Math.max(
    armLeft + fixture.armLength,
    mastLeft + fixture.mastThickness,
    lensX + fixture.headWidth * 0.5,
  );

  const tail: Ellipse = {
    x: lensX,
    y: poolY + along * 0.28,
    across: across * 1.14,
    along: along * 1.3,
  };

  // The throw box has to contain the tail's whole ellipse — its gradients reach
  // exactly zero at that radius — plus the head, so the lens's own glow fits.
  const throwTop = lensY - headHeight;
  const coneHalfAngle = Math.atan2(across * 0.78, Math.max(1, drop));
  const coneLength = drop + along * 0.45;
  // Slack for the angular feather, which spreads past the nominal half-angle.
  const coneHalfWidth = coneLength * Math.sin(coneHalfAngle) * 1.2;

  return {
    height: viewportHeight * (1 + 2 * BAND_MARGIN),
    lensX,
    lensY,
    fixture,
    fixtureBox: {
      x: fixtureLeft,
      y: 0,
      width: fixtureRight - fixtureLeft,
      height: lensY,
    },
    hotspot: {
      x: lensX,
      y: poolY - along * 0.28,
      across: across * 0.54,
      along: along * 0.38,
    },
    pool: { x: lensX, y: poolY, across, along },
    tail,
    throwBox: {
      x: lensX - tail.across,
      y: throwTop,
      width: tail.across * 2,
      height: tail.y + tail.along - throwTop,
    },
    coneBox: {
      x: lensX - coneHalfWidth,
      y: lensY,
      width: coneHalfWidth * 2,
      height: coneLength,
    },
    // The mist reaches the pool at roughly the pool's own width, which is what
    // makes the shaft and the thing it lands on read as one throw of light.
    coneHalfAngle: coneHalfAngle * DEGREES_PER_RADIAN,
    coneLength,
  };
}

export interface BandInput {
  /** Host content-box height in px. */
  height: number;
  /** Viewport height in px. */
  viewportHeight: number;
  /** 0..1 progress. */
  progress: number;
  /** `start` of the scroll mapping that produced `progress`. */
  scrollStart: number;
  /** `end` of the scroll mapping that produced `progress`. */
  scrollEnd: number;
}

/**
 * Host-space y of the band's top edge — the one number scroll changes.
 *
 * `scrollProgress` is an exact linear map from scroll offset to progress, so it
 * inverts exactly, and the host's position under the viewport is recoverable
 * from progress alone. That is what keeps this pure, and what makes
 * `scroll: false` plus a hand-driven `progress` land the band in precisely the
 * place a real scroll would. The `max(span, 1)` floor mirrors the same floor in
 * `scrollProgress`, so the round trip holds for degenerate geometry too.
 */
export function bandOffset(input: BandInput): number {
  const viewportHeight = Math.max(0, input.viewportHeight);
  const span = Math.max(0, input.height) + viewportHeight * (input.scrollStart - input.scrollEnd);
  return (
    clamp01(input.progress) * Math.max(span, 1) -
    viewportHeight * (input.scrollStart + BAND_MARGIN)
  );
}

export interface SwayShift {
  /** Offset for the fixture and the mist that leaves it. */
  head: Point;
  /** Offset for the pool on the ground, which swings further. */
  pool: Point;
}

/**
 * Sway of a head hanging on a wire, as two offsets applied by transform rather
 * than by rewriting geometry — which is why sway costs nothing here.
 *
 * Both terms start at zero phase, so time 0 is the rest position: an effect that
 * stops animating has to hold a frame that looks deliberate, and a lamp caught
 * mid-swing does not. The lift is at twice the swing rate and never positive,
 * because a pendulum rises at both ends of its arc and cannot sink below where
 * it hangs.
 */
export function swayShift(elapsedMs: number, amplitudePx: number, periodMs: number): SwayShift {
  const amplitude = Math.max(0, amplitudePx);
  if (amplitude === 0) return { head: { x: 0, y: 0 }, pool: { x: 0, y: 0 } };

  const phase = (Math.max(0, elapsedMs) / Math.max(1, periodMs)) * Math.PI * 2;
  // Weights sum to 1, so the excursion never exceeds the stated amplitude. The
  // second term is at an incommensurable rate: wind does not keep time.
  const x = amplitude * (0.72 * Math.sin(phase) + 0.28 * Math.sin(phase * 2.7));
  const y = amplitude * 0.16 * (Math.cos(phase) - 1);

  // A swinging head barely changes how far the light travels, so the pool takes
  // a quarter of the vertical share it takes horizontally.
  return {
    head: { x, y },
    pool: { x: x * POOL_SWAY_GAIN, y: y * POOL_SWAY_GAIN * 0.25 },
  };
}

/**
 * Brightness multiplier for a lamp on failing gear, 0..1.
 *
 * Mains hum is 100 or 120 Hz, which no display can show and no eye would read
 * as a buzz. What reads as one is a fast shimmer with a rare, brief dropout, so
 * that is what this is: `amount` is the depth of the dip, and the return value
 * stays within `[1 - amount, 1]`.
 */
export function buzzGain(elapsedMs: number, amount: number): number {
  const depth = clamp01(amount);
  if (depth === 0) return 1;

  const seconds = Math.max(0, elapsedMs) / 1000;
  const shimmer = 0.5 + 0.5 * Math.sin(seconds * 46.1);
  // Only the crest of the slow wave dips at all: a dropout that lasts about a
  // third of a second, roughly twice a lamp-cycle, reads as failing gear, while
  // a wider window reads as a throb. Full depth lands exactly on the crest.
  const dropout = Math.max(0, Math.sin(seconds * 1.7) - 0.97) / 0.03;
  return 1 - depth * (0.35 * shimmer + 0.65 * dropout);
}

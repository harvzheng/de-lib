/**
 * Neon tube maths: the split of one gas colour into the colours a lit tube
 * actually shows, and the flicker schedule behind it. Pure, DOM-free and
 * deterministic, because both parts are only right if they can be checked —
 * a dropout has to replay identically from a seed, and the tube core has to
 * stay hotter than its own halo, and neither is visible in a stylesheet.
 */

import { clamp01, lerp } from '../../core/math';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Stands in for a colour this module cannot parse. Classic pink-red neon. */
export const DEFAULT_GAS: Rgb = { r: 255, g: 46, b: 99 };

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Unlit tubing reads grey and slightly cool: it is glass, not paint. */
const COLD_GLASS: Rgb = { r: 146, g: 150, b: 158 };

/** How much of the gas tints the glass it sits in when the sign is off. */
const GLASS_TINT = 0.12;

/** Light that has travelled has lost the core, so the spill is pure gas, deepened. */
const SPILL_DEEPEN = 0.14;

/**
 * The bounce layer multiplies, so its colour is what a white surface is left
 * reflecting: mostly the surface, tinted by the gas. Pushed this close to white
 * because multiply can only darken, and a saturated multiply reads as ink.
 */
const BOUNCE_TOWARD_WHITE = 0.82;

const HEX = /^#([0-9a-f]+)$/i;
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i;

function channel(text: string): number {
  const numeric = text.endsWith('%') ? (Number(text.slice(0, -1)) * 255) / 100 : Number(text);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 255) : Number.NaN;
}

/**
 * Hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) and `rgb()`/`rgba()`; any alpha
 * is discarded, since a tube's alpha comes from `intensity`. Anything else —
 * including CSS colour keywords and `oklch()`, which need a document to resolve —
 * yields `DEFAULT_GAS` rather than throwing: a mistyped colour should leave a
 * working sign, not a dead page.
 */
export function parseColor(input: string): Rgb {
  const text = input.trim();

  const hex = HEX.exec(text);
  if (hex !== null) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: parseInt(digits[0] + digits[0], 16),
        g: parseInt(digits[1] + digits[1], 16),
        b: parseInt(digits[2] + digits[2], 16),
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
      };
    }
    return DEFAULT_GAS;
  }

  const call = RGB_FUNCTION.exec(text);
  if (call !== null) {
    const parts = call[1].split(/[\s,/]+/).filter((part) => part.length > 0);
    if (parts.length >= 3) {
      const r = channel(parts[0]);
      const g = channel(parts[1]);
      const b = channel(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
    }
  }

  return DEFAULT_GAS;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return { r: lerp(a.r, b.r, k), g: lerp(a.g, b.g, k), b: lerp(a.b, b.b, k) };
}

/** `"255 46 99"` — a channel triple, so CSS can spend it as `rgb(var(--x) / a)`. */
export function rgbChannels(colour: Rgb): string {
  return `${Math.round(colour.r)} ${Math.round(colour.g)} ${Math.round(colour.b)}`;
}

export function rgbCss(colour: Rgb, alpha = 1): string {
  const a = clamp01(alpha);
  return a >= 1 ? `rgb(${rgbChannels(colour)})` : `rgb(${rgbChannels(colour)} / ${a.toFixed(3)})`;
}

export interface TubePalette {
  /** Plasma seen straight through the glass: the gas pushed toward white. */
  core: Rgb;
  /** The gas itself — the halo colour, and the only colour far from the tube. */
  glow: Rgb;
  /** Gas light in the air around the sign, for the additive haze layer. */
  spill: Rgb;
  /** What a lit white surface is left reflecting, for the multiplying layer. */
  bounce: Rgb;
  /** Cold glass with the sign off, faintly tinted by the gas it holds. */
  glass: Rgb;
}

/**
 * One gas colour becomes four. The split is the whole effect: a tube lit with a
 * single colour for both core and halo reads as a drop shadow, because a real
 * tube's centre is over-exposed toward white while only the scattered light
 * keeps the gas hue. `coreHeat` is how far toward white the centre goes.
 */
export function tubePalette(colour: string, coreHeat: number): TubePalette {
  const gas = parseColor(colour);
  return {
    core: mixRgb(gas, WHITE, coreHeat),
    glow: gas,
    spill: mixRgb(gas, { r: 0, g: 0, b: 0 }, SPILL_DEEPEN),
    bounce: mixRgb(gas, WHITE, BOUNCE_TOWARD_WHITE),
    glass: mixRgb(COLD_GLASS, gas, GLASS_TINT),
  };
}

/** The tube core at a given output: hot plasma when lit, cold glass when out. */
export function coreAt(palette: TubePalette, brightness: number): Rgb {
  return mixRgb(palette.glass, palette.core, brightness);
}

/**
 * Blur radius of each glow copy as a multiple of the glow radius, tight to wide.
 * Four copies is a cost ceiling rather than a taste knob: each one is a full
 * blurred repaint of the host's text, and the widest is already 2x the radius.
 */
const GLOW_SPREAD = [0.14, 0.4, 1, 2.1] as const;

/** Alpha of each copy at full intensity. A halo that does not fall off is a box. */
const GLOW_ALPHA = [0.95, 0.6, 0.38, 0.26] as const;

/**
 * The `text-shadow` stack that is the glow, or `'none'` when there is nothing to
 * paint. Glyph-shaped by construction: nothing here knows what the glyphs are.
 */
export function glowStack(
  palette: TubePalette,
  radiusPx: number,
  intensity: number,
  brightness: number,
): string {
  const gain = clamp01(intensity) * clamp01(brightness);
  const radius = Math.max(0, radiusPx);
  if (gain <= 0 || radius <= 0) return 'none';

  let stack = '';
  for (let i = 0; i < GLOW_SPREAD.length; i += 1) {
    // The tightest copy is the core bleeding through the glass; the wide ones are
    // gas light scattered in air, which no longer carries that core.
    const colour = i === 0 ? palette.core : palette.glow;
    if (i > 0) stack += ', ';
    stack += `0 0 ${(radius * GLOW_SPREAD[i]).toFixed(2)}px ${rgbCss(colour, GLOW_ALPHA[i] * gain)}`;
  }
  return stack;
}

/** Additive haze in the air: the layer that lights a dark backdrop. */
export function hazeLevel(spill: number, brightness: number): number {
  return clamp01(spill) * clamp01(brightness);
}

/**
 * Light bounced off a nearby surface. Weaker than the haze because a bounce has
 * been absorbed once already.
 */
export function bounceLevel(spill: number, brightness: number): number {
  return clamp01(spill) * clamp01(brightness) * 0.8;
}

export interface FlickerOptions {
  /** 0..1 buzz depth and dropout frequency. 0 is a rock-steady tube. */
  flicker: number;
  /** Same seed, same failures, forever. */
  seed: number;
}

/**
 * Dropouts are scheduled per fixed slot of time, which is what makes them
 * stochastic *and* stateless: a slot's event is a pure function of its index, so
 * brightness can be asked for at any elapsed time in any order and the sequence
 * is the same. A slot is a shade over half a second, because that is roughly the
 * shortest gap at which two dropouts read as two faults and not as one long one.
 */
export const SLOT_MS = 620;

/** Shortest and longest a dropout runs. Both must fit inside two slots. */
const MIN_DROPOUT_MS = 110;
const MAX_DROPOUT_MS = 520;

/** How far into its slot an event may start, leaving room for its own length. */
const START_SPAN = 0.7;

/** A tube that has just cut out is not black: the gas keeps a residual afterglow. */
export const DROPOUT_FLOOR = 0.06;

/** A relight attempt is a partial strike, not a return to full output. */
const RELIGHT_LEVEL = 0.72;

/** At `flicker: 1`, the share of slots carrying a dropout. */
const MAX_DROPOUT_CHANCE = 0.55;

/**
 * Mains hum is 100–120 Hz, far past what a display can show, so the buzz is the
 * slowest ripple that still reads as electrical rather than as a pulse.
 */
const BUZZ_HZ = 17;

/** Buzz depth at `flicker: 1`. Above ~0.2 it stops reading as a healthy tube. */
const BUZZ_DEPTH = 0.14;

function hash01(cell: number, seed: number): number {
  let h = (cell | 0) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1D value noise, allocation-free: this is called a few times per step. */
function wave(x: number, seed: number): number {
  const cell = Math.floor(x);
  const t = x - cell;
  const a = hash01(cell, seed) * 2 - 1;
  const b = hash01(cell + 1, seed) * 2 - 1;
  return a + (b - a) * (t * t * (3 - 2 * t));
}

function buzz(elapsedMs: number, seed: number, amount: number): number {
  const x = (elapsedMs / 1000) * BUZZ_HZ;
  // Two incommensurate lattices: one alone has a lattice period the eye finds.
  const ripple = (wave(x, seed) + 0.5 * wave(x * 2.37 + 11.5, seed ^ 0x5bf03635)) / 1.5;
  // Only ever darkens, so the tube never overshoots its own full output.
  return 1 - BUZZ_DEPTH * amount * (0.5 + 0.5 * ripple);
}

/**
 * A failing tube does not fade: it snaps dark, the starter tries once or twice,
 * then the gas fills and it comes back. Odd phases are those relight attempts;
 * the last one ramps because striking is fast but filling is not.
 */
function dropEnvelope(u: number, stutters: number): number {
  const phases = stutters * 2 + 1;
  const phase = Math.min(Math.floor(u * phases), phases - 1);
  if (phase % 2 === 1) return RELIGHT_LEVEL;
  if (phase < phases - 1) return DROPOUT_FLOOR;

  const local = u * phases - phase;
  return DROPOUT_FLOOR + (1 - DROPOUT_FLOOR) * local * local;
}

function slotLevel(slot: number, elapsedMs: number, seed: number, amount: number): number {
  // Squared, so a low setting is genuinely rare rather than merely less frequent:
  // a sign that stutters every few seconds is broken, and "a bit of flicker" has
  // to mean "you will wait for it".
  const chance = MAX_DROPOUT_CHANCE * amount * amount;
  if (hash01(slot, seed ^ 0x1b873593) >= chance) return 1;

  const start = slot * SLOT_MS + hash01(slot, seed ^ 0x27d4eb2f) * SLOT_MS * START_SPAN;
  const duration = MIN_DROPOUT_MS + hash01(slot, seed ^ 0x165667b1) * (MAX_DROPOUT_MS - MIN_DROPOUT_MS);
  const u = (elapsedMs - start) / duration;
  if (u < 0 || u > 1) return 1;

  return dropEnvelope(u, 1 + Math.floor(hash01(slot, seed ^ 0x9e3779b1) * 3));
}

/**
 * Tube output at `elapsedMs`, in 0..1 — a fast low-amplitude buzz with occasional
 * seeded dropouts cut into it. Non-finite and negative times are read as 0 rather
 * than propagating: a clock glitch should not extinguish the sign.
 */
export function tubeBrightness(elapsedMs: number, options: FlickerOptions): number {
  const amount = clamp01(options.flicker);
  if (amount <= 0) return 1;

  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const seed = Math.trunc(options.seed) | 0;
  const slot = Math.floor(elapsed / SLOT_MS);

  // START_SPAN * SLOT_MS + MAX_DROPOUT_MS < 2 * SLOT_MS, so an event can only
  // ever spill into the next slot — the one before this is the whole backlog.
  const level = Math.min(
    slotLevel(slot, elapsed, seed, amount),
    slotLevel(slot - 1, elapsed, seed, amount),
  );

  return clamp01(buzz(elapsed, seed, amount) * level);
}

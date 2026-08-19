/**
 * Neon Sign — the host's own text, lit as a bent glass tube.
 *
 * The tube is the text itself: the runtime writes a `color` and a `text-shadow`
 * stack on the host, and the halo is that stack. Nothing here measures a glyph,
 * splits a string, wraps a character in a `<span>`, or copies the text into a
 * second element, so a heading, a mixed-font line, a numeral, an emoji and a
 * right-to-left paragraph all light up the same way, and the text stays real —
 * selectable, searchable, translatable and read by a screen reader as authored.
 *
 * The glow is deliberately not an SVG filter on the host. A filtered element
 * isolates blending inside itself, and the ambient spill is an injected child
 * that has to blend with the page *behind* the sign, not with the host's own
 * box: a bloom filter on the host would light nothing but itself. `text-shadow`
 * is also the only glyph-shaped blur available without touching the text.
 */

import { createLayer, onVisible } from '../../core/dom';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import {
  bounceLevel,
  coreAt,
  glowStack,
  hazeLevel,
  rgbChannels,
  rgbCss,
  tubeBrightness,
  tubePalette,
} from './tube';
import type { Effect } from '../../core/types';
import type { TubePalette } from './tube';

export interface NeonSignOptions {
  /**
   * Gas colour, as hex or `rgb()`. Default `'#ff2e63'`. Colour keywords and
   * `oklch()` cannot be resolved without a document, so they fall back to that
   * default: this effect derives four colours from the one you give it.
   */
  color?: string;
  /** 0..1 how far the tube core is over-exposed toward white. Default 0.78. */
  coreHeat?: number;
  /** Outer glow radius in px — the widest halo copy reaches about twice it. Default 18. */
  glowRadius?: number;
  /** 0..1 glow strength. Default 0.85. */
  intensity?: number;
  /** 0..1 light the sign throws onto its surroundings. Default 0.55. `0` stops both layers painting. */
  spill?: number;
  /** How far in px the pool of light reaches past the host's box. Default 140. */
  spillRadius?: number;
  /** 0..1 buzz depth and dropout frequency. Default 0.3. `0` is a healthy tube. */
  flicker?: number;
  /** `false` reads as cold unlit glass with no glow at all. Default true. */
  lit?: boolean;
  /** PRNG seed. Same seed, same failures. Default 1. */
  seed?: number;
}

export interface NeonSignHandle extends Effect<NeonSignOptions> {
  /** 0..1 tube output on screen right now. Demo-facing; not part of the look. */
  readonly brightness: number;
}

type Resolved = Required<NeonSignOptions>;

const DEFAULTS: Resolved = {
  color: '#ff2e63',
  coreHeat: 0.78,
  glowRadius: 18,
  intensity: 0.85,
  spill: 0.55,
  spillRadius: 140,
  flicker: 0.3,
  lit: true,
  seed: 1,
};

/** 20 writes/sec: the buzz reads as continuous, and the glow repaints 20 times a second rather than 60. */
/**
 * 12 steps/sec. Mains buzz reads as buzz well below the frame rate, and every step
 * repaints blurred copies of the host's text, so the rate is the single biggest
 * lever on what this effect costs.
 */
const FLICKER_STEP_MS = 1000 / 12;

/**
 * Brightness rungs. A write repaints up to four blurred copies of the host's
 * text, and the buzz spends most of its time inside a band a few percent wide,
 * so quantising it drops most of those repaints without a visible stair-step.
 */
const BRIGHTNESS_STEP = 1 / 64;


function resolve(base: Resolved, patch: NeonSignOptions): Resolved {
  return {
    color: patch.color ?? base.color,
    coreHeat: patch.coreHeat ?? base.coreHeat,
    glowRadius: patch.glowRadius ?? base.glowRadius,
    intensity: patch.intensity ?? base.intensity,
    spill: patch.spill ?? base.spill,
    spillRadius: patch.spillRadius ?? base.spillRadius,
    flicker: patch.flicker ?? base.flicker,
    lit: patch.lit ?? base.lit,
    seed: patch.seed ?? base.seed,
  };
}

export function createNeonSign(host: HTMLElement, options: NeonSignOptions = {}): NeonSignHandle {
  let config = resolve(DEFAULTS, options);
  let palette: TubePalette = tubePalette(config.color, config.coreHeat);
  let brightness = 0;
  let elapsed = 0;
  let stepMs = 0;
  let reduced = prefersReducedMotion();
  let visible = true;
  let stopTick: (() => void) | null = null;
  let destroyed = false;

  /** Captured before `createLayer` can promote the host, so `destroy` hands it back as found. */
  const hostPositionBefore = host.style.position;
  const hostColorBefore = host.style.color;
  const hostShadowBefore = host.style.textShadow;

  /**
   * Two layers, because a light source and a lit surface do not composite the
   * same way: bounce first — it multiplies, and lands on the surface — then haze
   * over it, which screens, and hangs in the air.
   */
  const bounce = createLayer(host, 'div', 'neon-sign-bounce');
  const haze = createLayer(host, 'div', 'neon-sign-haze');
  /**
   * The gradient and the SVG filter live on an inner element, and the flicker writes
   * opacity on the outer one. They cannot be the same element: Gecko and WebKit
   * re-rasterise a filtered element whenever a property on that element changes, so
   * an opacity write on the filtered layer re-runs turbulence, displacement and a
   * wide blur over a full-bleed layer - measured at 111ms p95 in WebKit with ten of
   * these on the page, against 18ms once they are split. Two elements per spill
   * layer is the price of compositing the flicker instead of re-rendering it.
   */
  const bounceField = document.createElement('div');
  const hazeField = document.createElement('div');
  bounceField.className = 'neon-sign-field';
  hazeField.className = 'neon-sign-field';
  bounce.append(bounceField);
  haze.append(hazeField);
  for (const layer of [bounce, haze]) layer.setAttribute('aria-hidden', 'true');

  function applyGas(): void {
    palette = tubePalette(config.color, config.coreHeat);
    hazeField.style.setProperty('--neon-sign-haze', rgbChannels(palette.spill));
    bounceField.style.setProperty('--neon-sign-bounce', rgbChannels(palette.bounce));
  }

  function applySpill(): void {
    const radius = Math.max(0, config.spillRadius);
    // A pool that stops at the host's box lights nothing, and `createLayer` sizes
    // a layer to exactly that box, so the geometry is overwritten here. `auto`
    // is required: a 100% width would win over the negative right inset.
    const inset = `${-radius}px`;
    for (const layer of [bounce, haze]) {
      layer.style.inset = inset;
      layer.style.width = 'auto';
      layer.style.height = 'auto';
      layer.style.display = config.spill > 0 ? 'block' : 'none';
    }
  }

  /**
   * Output to hold right now, on a brightness rung. Everything that stops the
   * clock — reduced motion, an off-screen host, `flicker: 0` — holds a *fully
   * lit* tube: "no motion" must never mean "no sign". `lit: false` is the only
   * thing that puts it out.
   */
  function currentLevel(): number {
    let raw = 1;
    if (!config.lit) raw = 0;
    else if (config.flicker > 0 && !reduced && visible) raw = tubeBrightness(elapsed, config);
    return Math.round(raw / BRIGHTNESS_STEP) * BRIGHTNESS_STEP;
  }

  function paintTube(): void {
    host.style.color = rgbCss(coreAt(palette, brightness));
    host.style.textShadow = glowStack(palette, config.glowRadius, config.intensity, brightness);
    haze.style.opacity = hazeLevel(config.spill, brightness).toFixed(3);
    bounce.style.opacity = bounceLevel(config.spill, brightness).toFixed(3);
  }

  function tick(_now: number, deltaMs: number): void {
    elapsed += deltaMs;
    stepMs += deltaMs;
    if (stepMs < FLICKER_STEP_MS) return;
    stepMs %= FLICKER_STEP_MS;

    const level = currentLevel();
    if (level === brightness) return;
    brightness = level;
    paintTube();
  }

  function syncActivity(): void {
    const animating = config.lit && config.flicker > 0 && visible && !reduced;
    if (animating === (stopTick !== null)) return;

    // Promoted only while the flicker is running. A composited layer is what makes
    // the opacity write cheap, but ten permanently promoted full-bleed layers is
    // video memory spent on a sign that is holding still.
    for (const layer of [bounce, haze]) layer.style.willChange = animating ? 'opacity' : '';

    if (!animating) {
      stopTick?.();
      stopTick = null;
      brightness = currentLevel();
      paintTube();
      return;
    }
    stopTick = onTick(tick);
  }

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncActivity();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    syncActivity();
  });

  // No resize handling: the halo is in px, the pool is sized by insets off the
  // host's box, and the filter region is a percentage of it. A resized host
  // carries all three with it.
  applyGas();
  applySpill();
  brightness = currentLevel();
  paintTube();
  syncActivity();

  return {
    get brightness(): number {
      return brightness;
    },

    setOptions(patch: NeonSignOptions): void {
      if (destroyed) return;
      const previous = config;
      config = resolve(config, patch);

      if (config.color !== previous.color || config.coreHeat !== previous.coreHeat) applyGas();
      if (
        config.spill !== previous.spill ||
        config.spillRadius !== previous.spillRadius ||
        config.seed !== previous.seed
      ) {
        applySpill();
      }
      // A new seed is a different tube; it fails on its own schedule from now.
      if (config.seed !== previous.seed) elapsed = 0;

      brightness = currentLevel();
      paintTube();
      syncActivity();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopVisible();
      stopMotion();
      bounce.remove();
      haze.remove();
      host.style.color = hostColorBefore;
      host.style.textShadow = hostShadowBefore;
      host.style.position = hostPositionBefore;
    },
  };
}

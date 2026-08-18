/**
 * WebGL leak renderer. Every layer the CSS renderer stacks — two wide gradient
 * blurs, five blend-mode layers, a displaced edge and a thresholded halation
 * bleed — is a few dozen arithmetic operations per pixel here, in one pass, so
 * this path costs the same on every engine instead of tracking how well each
 * one caches a filtered, blended subtree.
 *
 * A null return means WebGL2 is unavailable and the caller must use the CSS
 * renderer, which stays the floor this sits on top of.
 */

import { createLayer, onVisible } from '../../core/dom';
import { createQuadRenderer } from '../../core/gl';
import { clamp01 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import {
  buildSweepBands,
  computeLeakStage,
  createLeakStage,
  leakDrift,
  leakFlicker,
  sweepBandPlacement,
} from './leaks';
import { LEAK_FRAGMENT_SOURCE } from './shader';
import type { QuadRenderer } from '../../core/gl';
import type { SweepBandGeometry } from './leaks';
import type { LeakConfig, LeakMedia, LeakRendererInstance } from './index';

/**
 * CSS `hsl()` to sRGB, so the shader's gradient stops are the same colours the
 * stylesheet's custom properties resolve to.
 */
function hslToRgb(hue: number, saturation: number, lightness: number, out: Float32Array): void {
  const h = ((((hue % 360) + 360) % 360) / 30) % 12;
  const a = saturation * Math.min(lightness, 1 - lightness);
  for (let i = 0; i < 3; i += 1) {
    // Channel offsets 0, 8, 4 in the 12-sector hue wheel.
    const k = (h + i * 8) % 12;
    out[i] = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  }
}

function mediaSize(media: LeakMedia, out: Float32Array): void {
  if (media instanceof HTMLVideoElement) {
    out[0] = media.videoWidth;
    out[1] = media.videoHeight;
    return;
  }
  out[0] = media.naturalWidth;
  out[1] = media.naturalHeight;
}

export function createWebglLeakRenderer(
  host: HTMLElement,
  initial: LeakConfig,
): LeakRendererInstance | null {
  const stage = createLayer(host, 'div', 'light-leak-transition-stage');
  stage.setAttribute('aria-hidden', 'true');
  const frame = document.createElement('div');
  frame.className = 'light-leak-transition-frame';
  const canvas = document.createElement('canvas');
  canvas.className = 'light-leak-transition-canvas';
  frame.append(canvas);
  stage.append(frame);

  const created = createQuadRenderer(canvas, LEAK_FRAGMENT_SOURCE);
  if (created === null) {
    stage.remove();
    return null;
  }
  // Rebound non-null: the per-frame closures below cannot see the guard above.
  const quad: QuadRenderer = created;

  let config = initial;
  let progress = 0;
  let elapsedMs = 0;
  let reduced = prefersReducedMotion();
  let visible = true;
  let destroyed = false;
  let bandGeometry = buildSweepBands(config.seed);
  let bandSeed = config.seed;
  let uploadedFrom: LeakMedia | null = null;
  let uploadedTo: LeakMedia | null = null;
  let stopTick: (() => void) | null = null;

  const leakStage = createLeakStage();
  const fromSize = new Float32Array(2);
  const toSize = new Float32Array(2);
  const drift = new Float32Array(2);
  const red = new Float32Array(3);
  const amber = new Float32Array(3);
  const magenta = new Float32Array(3);
  const bandXform = new Float32Array(12);
  const bandShape = new Float32Array(6);

  function applyWarmth(): void {
    const warmth = clamp01(config.warmth);
    hslToRgb(4 + warmth * 19, 1, (39 + warmth * 17) / 100, red);
    hslToRgb(19 + warmth * 24, 1, (55 + warmth * 23) / 100, amber);
    hslToRgb(334 + warmth * 20, 0.94, (45 + warmth * 17) / 100, magenta);
  }

  function applyBands(): void {
    for (let i = 0; i < 3; i += 1) {
      const geometry = bandGeometry[i] as SweepBandGeometry;
      sweepBandPlacement(geometry, leakStage, bandXform, i * 4);
      const radians = (bandXform[i * 4 + 2] * Math.PI) / 180;
      bandXform[i * 4 + 2] = Math.cos(radians);
      bandXform[i * 4 + 3] = Math.sin(radians);
      bandShape[i * 2] = geometry.scale;
      bandShape[i * 2 + 1] = geometry.width / 100;
    }
  }

  function draw(): void {
    const { from, to } = config;
    if (destroyed || from === null || to === null) return;

    quad.resize();
    if (quad.width === 0 || quad.height === 0) return;

    mediaSize(from, fromSize);
    mediaSize(to, toSize);
    if (fromSize[0] === 0 || toSize[0] === 0) return;

    // Stills upload once; a video re-uploads every frame, which is the only
    // reason this renderer needs the tick when nothing else is animating.
    if (from !== uploadedFrom || from instanceof HTMLVideoElement) {
      quad.upload('uFrom', from);
      uploadedFrom = from;
    }
    if (to !== uploadedTo || to instanceof HTMLVideoElement) {
      quad.upload('uTo', to);
      uploadedTo = to;
    }

    computeLeakStage(config, progress, leakStage);
    if (config.style === 'sweep') applyBands();
    leakDrift(elapsedMs, config.seed, drift);
    const radians = (leakStage.angle * Math.PI) / 180;

    quad.render({
      uFromSize: fromSize,
      uToSize: toSize,
      uLeakOffset: [leakStage.offsetX, leakStage.offsetY],
      uLeakRot: [Math.cos(radians), Math.sin(radians)],
      uDrift: drift,
      uBandXform: bandXform,
      uBandShape: bandShape,
      uRed: red,
      uAmber: amber,
      uMagenta: magenta,
      uLeakScale: leakStage.scale,
      uFromOpacity: leakStage.fromOpacity,
      uExposure: leakStage.exposure,
      uLeakOpacity: leakStage.leakOpacity * leakFlicker(elapsedMs, config.seed),
      uCoreOpacity: leakStage.coreOpacity,
      uHalationOpacity: leakStage.halationOpacity,
      uHalationEdge: 0.86 - clamp01(config.halation) * 0.3,
      uHalationRadius: 6 + Math.max(0, config.softness) * 0.13,
      // The stylesheet's grain is an overlay-blended tile at this opacity;
      // applyGrain's signed noise needs about a third of it to read the same.
      uGrain: leakStage.grainOpacity * 0.38,
      uSoftness: Math.max(0, config.softness),
      uOrganic: clamp01(config.organic),
      uSweep: config.style === 'sweep' ? 1 : 0,
      uSeed: config.seed,
      uTime: elapsedMs / 1000,
    });
  }

  function syncActivity(): void {
    const ready = config.from !== null && config.to !== null;
    const video = config.from instanceof HTMLVideoElement || config.to instanceof HTMLVideoElement;
    const playing = visible && !reduced && !destroyed;

    for (const media of [config.from, config.to]) {
      if (!(media instanceof HTMLVideoElement)) continue;
      if (playing) {
        void media.play().catch((error: unknown) => {
          console.warn('light-leak-transition: video playback was refused.', error);
        });
      } else {
        media.pause();
      }
    }

    // Flare flicker, drift and grain are the only autonomous motion; at a clean
    // endpoint with stills there is nothing left to redraw.
    const moving = leakStage.leakOpacity > 0 || leakStage.grainOpacity > 0 || video;
    const animating = ready && playing && moving;
    if (animating && stopTick === null) {
      stopTick = onTick((_now, deltaMs) => {
        elapsedMs += deltaMs;
        draw();
      });
    } else if (!animating && stopTick !== null) {
      stopTick();
      stopTick = null;
    }
  }

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncActivity();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    syncActivity();
    // Scroll scrubbing keeps working while frozen, so hold a drawn frame.
    if (reduced) draw();
  });

  applyWarmth();
  computeLeakStage(config, progress, leakStage);
  applyBands();
  syncActivity();
  draw();

  return {
    setProgress(value: number): void {
      progress = value;
      // While the tick runs it draws anyway; this covers the frozen case.
      if (stopTick === null) draw();
      syncActivity();
    },

    setOptions(next: LeakConfig): void {
      const warmthChanged = next.warmth !== config.warmth;
      const seedChanged = next.seed !== bandSeed;
      config = next;
      if (warmthChanged) applyWarmth();
      if (seedChanged) {
        bandSeed = next.seed;
        bandGeometry = buildSweepBands(next.seed);
      }
      computeLeakStage(config, progress, leakStage);
      applyBands();
      syncActivity();
      if (stopTick === null) draw();
    },

    resize(): void {
      if (stopTick === null) draw();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopVisible();
      stopMotion();
      for (const media of [config.from, config.to]) {
        if (media instanceof HTMLVideoElement) media.pause();
      }
      quad.dispose();
      stage.remove();
    },
  };
}

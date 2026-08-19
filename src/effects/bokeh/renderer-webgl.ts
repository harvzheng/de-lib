/**
 * WebGL bokeh renderer. The upgrade, never the requirement: same disc list as
 * the CSS renderer, uploaded as uniforms, but drawn per pixel — which is what
 * buys polygonal aperture blades, a chromatically fringed rim, and overlapping
 * discs that roll off instead of clipping to white. A null return means WebGL2
 * is unavailable and the caller must use the CSS renderer.
 *
 * The canvas is opaque black and composited with `mix-blend-mode: screen`, where
 * black is the identity. That is deliberate: a straight-alpha canvas over live
 * DOM composites slightly differently in Blink and Gecko, and screen over black
 * has no alpha for them to disagree about.
 */

import { createLayer, onVisible } from '../../core/dom';
import { createQuadRenderer } from '../../core/gl';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { discState } from './discs';
import { BOKEH_FRAGMENT_SOURCE, SHADER_MAX_DISCS } from './shader';
import type { DiscStateOptions } from './discs';
import type { QuadRenderer } from '../../core/gl';
import type { BokehConfig, BokehRendererInstance } from './index';

let colourProbe: CanvasRenderingContext2D | null | undefined;

/** Resolves any CSS colour to 0..1 RGB by letting the 2D context parse it. */
function parseColour(value: string): [number, number, number] {
  if (colourProbe === undefined) {
    colourProbe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  if (colourProbe === null) return [1, 1, 1];
  // An unparseable value leaves fillStyle untouched, so seed a known colour.
  colourProbe.fillStyle = '#ffffff';
  colourProbe.fillStyle = value;
  colourProbe.fillRect(0, 0, 1, 1);
  const pixel = colourProbe.getImageData(0, 0, 1, 1).data;
  return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
}

export function createWebglBokehRenderer(
  host: HTMLElement,
  initial: BokehConfig,
): BokehRendererInstance | null {
  const layer = createLayer(host, 'div', 'bokeh-layer bokeh-layer--gl');
  layer.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'bokeh-canvas';
  layer.append(canvas);

  const created = createQuadRenderer(canvas, BOKEH_FRAGMENT_SOURCE, { alpha: false });
  if (created === null) {
    layer.remove();
    return null;
  }
  // Rebound non-null: the per-frame closures below cannot see the guard above.
  const quad: QuadRenderer = created;

  // Allocated once and mutated in place: uploading the field per frame must not
  // allocate, and the shader's arrays are a fixed size.
  const discData = new Float32Array(SHADER_MAX_DISCS * 4);
  const tintData = new Float32Array(SHADER_MAX_DISCS * 3);

  let config = initial;
  let palette = config.tints.map(parseColour);
  let progress = 0;
  let time = 0;
  let reduced = prefersReducedMotion();
  let visible = true;
  let stopTick: (() => void) | null = null;
  let destroyed = false;

  function stateOptions(width: number, height: number): DiscStateOptions {
    return {
      width,
      height,
      intensity: config.intensity,
      shimmer: config.shimmer,
      shimmerRate: config.shimmerRate,
      parallax: config.parallax,
      drift: config.drift,
    };
  }

  function draw(): void {
    if (destroyed) return;
    quad.resize();
    if (quad.width === 0 || quad.height === 0) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    const options = stateOptions(width, height);
    const short = Math.min(width, height);
    const count = Math.min(config.discs.length, SHADER_MAX_DISCS);

    for (let i = 0; i < count; i += 1) {
      const disc = config.discs[i];
      const state = discState(disc, progress, time, options);
      const slot = i * 4;
      // Height units, and the GL origin is bottom-left where the layout's is top-left.
      discData[slot] = state.x / height;
      discData[slot + 1] = 1 - state.y / height;
      discData[slot + 2] = (disc.size * short * state.scale) / (2 * height);
      discData[slot + 3] = state.opacity;

      const tintSlot = i * 3;
      if (disc.color === null) {
        const tint = palette.length > 0 ? palette[disc.tint % palette.length] : [1, 1, 1];
        tintData[tintSlot] = tint[0];
        tintData[tintSlot + 1] = tint[1];
        tintData[tintSlot + 2] = tint[2];
      } else {
        tintData[tintSlot] = disc.color[0] / 255;
        tintData[tintSlot + 1] = disc.color[1] / 255;
        tintData[tintSlot + 2] = disc.color[2] / 255;
      }
    }

    quad.render({
      uDiscs: discData,
      uDiscTints: tintData,
      uDiscCount: count,
      uSoftness: config.softness,
      uRim: config.rim,
      uBlades: config.blades,
    });
  }

  function syncActivity(): void {
    // Sway and the shimmer crawl are the only time-driven terms; without drift
    // there is nothing to animate between scroll events.
    const animating = config.drift > 0 && visible && !reduced && !destroyed;

    if (animating && stopTick === null) {
      stopTick = onTick((_now, deltaMs) => {
        time += deltaMs / 1000;
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

  syncActivity();
  draw();

  return {
    setProgress(value: number): void {
      progress = value;
      // While the tick runs it draws anyway; this covers the frozen case.
      if (stopTick === null) draw();
    },

    setOptions(next: BokehConfig): void {
      if (next.tints !== config.tints) palette = next.tints.map(parseColour);
      config = next;
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
      quad.dispose();
      layer.remove();
    },
  };
}

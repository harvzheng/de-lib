/**
 * WebGL crumple renderer. This is the one that looks like paper, and the reason it
 * needs a GPU is specific: the sheet is a max-of-cones power diagram evaluated per
 * pixel, and its normals are finite differences of that field at float precision.
 * SVG carries a height map as 8-bit alpha, so a broad fold's gradient bands into
 * contour rings once it is amplified; Canvas 2D could evaluate the same field only
 * in a per-pixel JS loop, which is seconds per bake at this size.
 *
 * The canvas composites with straight alpha and **no blend mode**: the shader paints
 * toward the shadow colour where the sheet turns away and toward the paper's lit
 * tone where it faces the light, and paints nothing where the sheet is flat. That
 * keeps compositing engine-neutral — nothing depends on how an engine isolates a
 * stacking context.
 *
 * A null return means WebGL2 is unavailable and the caller must use the CSS renderer.
 */

import { createQuadRenderer } from '../../core/gl';
import { clamp01 } from '../../core/math';
import { CRUMPLE_FRAGMENT_SOURCE } from './shader';
import type { QuadRenderer } from '../../core/gl';
import type { CrumpledConfig, CrumpledRendererInstance } from './index';

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

export function createWebglCrumpleRenderer(
  stack: HTMLElement,
  initial: CrumpledConfig,
): CrumpledRendererInstance | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'crumpled-paper-canvas';
  stack.append(canvas);

  // One octave of the field costs nine cones and the normal costs three field
  // evaluations, so the drawing buffer is held at 1x: this is shading, not detail.
  const created = createQuadRenderer(canvas, CRUMPLE_FRAGMENT_SOURCE, { dprMax: 1 });
  if (created === null) {
    canvas.remove();
    return null;
  }
  // Rebound non-null: the closures below cannot see the guard above.
  const quad: QuadRenderer = created;

  let config = initial;
  let paper = parseColour(config.paperColor);
  let azimuth = config.light;
  let destroyed = false;

  function draw(): void {
    if (destroyed) return;
    quad.resize();
    if (quad.width === 0 || quad.height === 0) return;

    quad.render({
      uScale: Math.max(24, config.scale),
      uDepth: clamp01(config.depth),
      uSharpness: clamp01(config.creases),
      uAzimuth: azimuth,
      // A sheet lit from directly overhead loses its creases; this is the one
      // lighting angle that is not an option, because no value of it looks better.
      uElevation: 42,
      uShine: clamp01(config.shine),
      uGrain: clamp01(config.grain),
      uSoiling: clamp01(config.soiling),
      // Depth drives how much shading lands as well as how deep the relief is:
      // separating the two only ever produces a flat sheet with dark creases.
      uStrength: 0.2 + clamp01(config.depth) * 0.5,
      uPaper: paper,
      uTone: clamp01(config.tone),
      uSeed: config.seed,
    });
  }

  return {
    setOptions(next: CrumpledConfig): void {
      if (next.paperColor !== config.paperColor) paper = parseColour(next.paperColor);
      config = next;
      draw();
    },

    setLight(nextAzimuth: number): void {
      azimuth = nextAzimuth;
      draw();
    },

    resize(): void {
      draw();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      quad.dispose();
      canvas.remove();
    },
  };
}

/**
 * WebGL filmstock renderer. Every stage of this look is per-pixel arithmetic on
 * one video frame — dye cross-talk, three characteristic curves, a thresholded
 * bleed, a noise field, five blended artefact layers — which a fragment shader
 * finishes in a single pass and an SVG filter chain can only reach through half a
 * dozen intermediate surfaces. A null return means WebGL2 is unavailable and the
 * caller must fall back to the Canvas/SVG renderer.
 */

import { createLayer } from '../../core/dom';
import { createQuadRenderer } from '../../core/gl';
import { mulberry32 } from '../../core/math';
import { DUST_SPECKS } from './frame';
import {
  HALATION_AMBER,
  HALATION_SOFTNESS,
  LOOKS,
  colorMatrix3,
  curveSamples,
  halationEdge,
  halationSigma,
} from './grade';
import { FILMSTOCK_FRAGMENT_SOURCE } from './shader';
import type { QuadRenderer, ScalarUniform } from '../../core/gl';
import type { FrameState } from './frame';
import type { FilmstockConfig, FilmstockRendererInstance } from './index';

/** Constant: the amber is inter-image scatter, not an option. */
const AMBER = colorMatrix3(HALATION_AMBER);
const DEGREES = Math.PI / 180;
/**
 * Whole-lattice jump between held frames. The CSS renderer re-seeds
 * `feTurbulence` for a wholly new field; walking this far through the noise is
 * the same thing from a generator that has no seed.
 */
const GRAIN_FIELD_SPAN = 512;
/**
 * Two octaves of value noise spread wider than two octaves of feTurbulence's
 * gradient noise, so the same amplitude grains harder. Measured against the CSS
 * renderer across the whole `grain` range, this ratio holds the two fields at one
 * visible contrast.
 */
const GRAIN_FIELD_CONTRAST = 0.68;

export function createWebglFilmstockRenderer(
  host: HTMLElement,
  initial: FilmstockConfig,
): FilmstockRendererInstance | null {
  const poster = createLayer(host, 'div', 'filmstock-poster');
  poster.setAttribute('aria-hidden', 'true');
  const canvas = createLayer(host, 'canvas', 'filmstock-gl');
  canvas.setAttribute('aria-hidden', 'true');

  const created = createQuadRenderer(canvas, FILMSTOCK_FRAGMENT_SOURCE);
  if (created === null) {
    canvas.remove();
    poster.remove();
    return null;
  }
  // Rebound non-null: the per-frame closures below cannot see the guard above.
  const quad: QuadRenderer = created;

  let config = initial;
  let boxWidth = 0;
  let boxHeight = 0;
  let destroyed = false;

  // One uniform record, rewritten in place. A fresh object and fresh vectors per
  // held frame would be garbage generated on a timer for no benefit.
  const videoSize = new Float32Array(2);
  const weave = new Float32Array(3);
  const halationCut = new Float32Array(2);
  const grain = new Float32Array(2);
  const grainOffset = new Float32Array(2);
  const band = new Float32Array(3);
  const breathing = new Float32Array(2);
  const flash = new Float32Array(2);
  const uniforms: Record<string, ScalarUniform> = {
    uVideoSize: videoSize,
    uCurve: curveSamples(LOOKS[config.look]),
    uCrossTalk: colorMatrix3(LOOKS[config.look].crossTalk),
    uAmber: AMBER,
    uExposure: 1,
    uWeave: weave,
    uHalation: 0,
    uHalationCut: halationCut,
    uHalationSigma: 0,
    uGrain: grain,
    uGrainOffset: grainOffset,
    uVignette: 0,
    uBand: band,
    uBreathing: breathing,
    uFlash: flash,
    uSpecks: new Float32Array(DUST_SPECKS * 4),
    uSpeckCount: 0,
    uScratch: new Float32Array(4),
    uScratchOpacity: 0,
  };

  function applyOptions(): void {
    poster.style.backgroundImage =
      config.poster === undefined ? 'none' : `url(${JSON.stringify(config.poster)})`;

    uniforms.uHalation = config.halation;
    halationCut[0] = halationEdge(config.halation);
    halationCut[1] = HALATION_SOFTNESS;
    uniforms.uHalationSigma = halationSigma(config.halation, boxWidth, boxHeight);
    // 0.7 is the amplitude the CSS renderer hands grainMatrix; the shader's
    // silver field is that same contrast around neutral grey.
    grain[0] = config.grain * 0.7 * GRAIN_FIELD_CONTRAST;
    grain[1] = config.grainSize;
    uniforms.uVignette = config.vignette;
  }

  applyOptions();

  return {
    paint(video: HTMLVideoElement, state: FrameState): void {
      if (destroyed || video.videoWidth <= 0 || video.videoHeight <= 0) return;
      quad.resize();
      if (quad.width === 0 || quad.height === 0) return;

      // The whole judder: one upload per held frame rather than per display
      // frame, which is why `upload` is a separate call from `render`.
      quad.upload('uVideo', video);

      videoSize[0] = video.videoWidth;
      videoSize[1] = video.videoHeight;
      uniforms.uExposure = state.exposure;
      weave[0] = state.weaveX;
      weave[1] = state.weaveY;
      weave[2] = state.weaveRotation * DEGREES;

      // The same seed expression the CSS renderer gives feTurbulence, so both
      // fields change on the same held frames.
      const field = mulberry32((state.frame * 13 + 17) >>> 0);
      grainOffset[0] = field() * GRAIN_FIELD_SPAN;
      grainOffset[1] = field() * GRAIN_FIELD_SPAN;

      band[0] = state.bandOpacity;
      band[1] = state.bandY;
      band[2] = state.bandHeight;
      breathing[0] = state.warmBreathing;
      breathing[1] = state.coolBreathing;
      flash[0] = state.flashOpacity;
      flash[1] = state.flashBright ? 1 : 0;
      uniforms.uSpecks = state.specks;
      uniforms.uSpeckCount = state.speckCount;
      uniforms.uScratch = state.scratch;
      uniforms.uScratchOpacity = state.scratchOpacity;

      quad.render(uniforms);
    },

    clear(): void {
      if (destroyed) return;
      const gl = quad.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    setOptions(next: FilmstockConfig): void {
      if (next.look !== config.look) {
        uniforms.uCurve = curveSamples(LOOKS[next.look]);
        uniforms.uCrossTalk = colorMatrix3(LOOKS[next.look].crossTalk);
      }
      config = next;
      applyOptions();
    },

    resize(width: number, height: number): void {
      boxWidth = width;
      boxHeight = height;
      // The bleed radius follows the box; the drawing buffer follows the canvas.
      uniforms.uHalationSigma = halationSigma(config.halation, width, height);
      quad.resize();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      quad.dispose();
      canvas.remove();
      poster.remove();
    },
  };
}

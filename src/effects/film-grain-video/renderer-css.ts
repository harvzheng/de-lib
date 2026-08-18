/**
 * Canvas 2D + SVG filter renderer: the floor that needs no GPU. Canvas samples
 * and holds the video frame, `feColorMatrix` and `feComponentTransfer` carry the
 * dye cross-talk and the per-channel stock curves, and CSS blend modes composite
 * the halation, the weighted turbulence grain and the print wear.
 *
 * It costs far more per held frame than the WebGL renderer — every layer is a
 * surface the engine has to filter and blend again, and `feTurbulence` covers the
 * whole box — but it applies to live DOM, it is inspectable in devtools, and it
 * works with no WebGL2 context at all.
 */

import { createLayer } from '../../core/dom';
import { createFilter } from '../../core/svg';
import { DUST_SPECKS, DUST_VIEWBOX } from './frame';
import {
  GRADE_FILTER,
  GRAIN_FILTER,
  HALATION_FILTER,
  LOOKS,
  grainMatrix,
  halationSigma,
  halationThreshold,
} from './grade';
import type { FrameState } from './frame';
import type { FilmstockConfig, FilmstockRendererInstance } from './index';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The halation layer is blurred and the grain layer is noise: half resolution is free. */
const AUXILIARY_SCALE = 0.5;

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: true });
  if (context === null) throw new Error('Film Grain Video requires a Canvas 2D context.');
  return context;
}

function drawCover(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): void {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(video, (canvas.width - width) * 0.5, (canvas.height - height) * 0.5, width, height);
}

/** One scratch: the frame state never carries more than one at a time. */
function createDustSvg(): {
  svg: SVGSVGElement;
  specks: SVGCircleElement[];
  scratch: SVGRectElement;
} {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'filmstock-dust-svg');
  svg.setAttribute('viewBox', `0 0 ${DUST_VIEWBOX} ${DUST_VIEWBOX}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const specks: SVGCircleElement[] = [];
  for (let i = 0; i < DUST_SPECKS; i += 1) {
    const speck = document.createElementNS(SVG_NS, 'circle');
    speck.setAttribute('class', 'filmstock-dust-speck');
    svg.appendChild(speck);
    specks.push(speck);
  }

  const scratch = document.createElementNS(SVG_NS, 'rect');
  scratch.setAttribute('class', 'filmstock-dust-scratch');
  svg.appendChild(scratch);
  return { svg, specks, scratch };
}

export function createCssFilmstockRenderer(
  host: HTMLElement,
  initial: FilmstockConfig,
): FilmstockRendererInstance {
  const gate = createLayer(host, 'div', 'filmstock-gate');
  gate.setAttribute('aria-hidden', 'true');
  const poster = createLayer(gate, 'div', 'filmstock-poster');
  const frameCanvas = createLayer(gate, 'canvas', 'filmstock-frame');
  const halationCanvas = createLayer(gate, 'canvas', 'filmstock-halation');
  const grainCanvas = createLayer(gate, 'canvas', 'filmstock-grain');
  const vignette = createLayer(host, 'div', 'filmstock-vignette');
  vignette.setAttribute('aria-hidden', 'true');
  const shutterBand = createLayer(host, 'div', 'filmstock-shutter-band');
  shutterBand.setAttribute('aria-hidden', 'true');
  const colorBreathing = createLayer(host, 'div', 'filmstock-color-breathing');
  colorBreathing.setAttribute('aria-hidden', 'true');
  const flash = createLayer(host, 'div', 'filmstock-flash');
  flash.setAttribute('aria-hidden', 'true');
  const dustLayer = createLayer(host, 'div', 'filmstock-dust');
  const dust = createDustSvg();
  dustLayer.appendChild(dust.svg);

  const frameContext = canvasContext(frameCanvas);
  const halationContext = canvasContext(halationCanvas);
  const grainContext = canvasContext(grainCanvas);

  const gradeFilter = createFilter(GRADE_FILTER, 'filmstock-grade');
  const halationFilter = createFilter(HALATION_FILTER, 'filmstock-halation');
  const grainFilter = createFilter(GRAIN_FILTER, 'filmstock-grain');

  halationCanvas.style.filter = halationFilter.css;
  grainCanvas.style.filter = grainFilter.css;

  let config = initial;
  let boxWidth = 0;
  let boxHeight = 0;
  let pixelRatio = 1;
  let destroyed = false;

  function sizeCanvas(canvas: HTMLCanvasElement, scale: number): void {
    const width = Math.max(1, Math.round(boxWidth * pixelRatio * scale));
    const height = Math.max(1, Math.round(boxHeight * pixelRatio * scale));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
  }

  function applyOptions(): void {
    const look = LOOKS[config.look];
    gradeFilter.set('cross-talk', { values: look.crossTalk });
    gradeFilter.set('curve-r', { tableValues: look.red });
    gradeFilter.set('curve-g', { tableValues: look.green });
    gradeFilter.set('curve-b', { tableValues: look.blue });

    grainFilter.set('noise', { baseFrequency: (1 / config.grainSize).toFixed(4) });
    grainFilter.set('amplitude', { values: grainMatrix(config.grain * 0.7) });
    grainCanvas.hidden = config.grain <= 0;

    halationFilter.set('threshold', { tableValues: halationThreshold(config.halation) });
    halationFilter.set('bleed', {
      stdDeviation: halationSigma(config.halation, boxWidth, boxHeight).toFixed(2),
    });
    halationCanvas.style.opacity = String(config.halation);
    halationCanvas.hidden = config.halation <= 0;

    poster.style.backgroundImage =
      config.poster === undefined ? 'none' : `url(${JSON.stringify(config.poster)})`;
    vignette.style.opacity = String(config.vignette);
    dustLayer.hidden = config.dust <= 0;
  }

  function paintProjector(state: FrameState): void {
    shutterBand.style.opacity = state.bandOpacity.toFixed(4);
    // Parked above the frame while it is off, so a stale band cannot show
    // through a later opacity change.
    shutterBand.style.transform =
      state.bandOpacity > 0
        ? `translate3d(0, ${state.bandY.toFixed(2)}px, 0)`
        : 'translate3d(0, -100%, 0)';

    colorBreathing.style.setProperty('--filmstock-warm-opacity', state.warmBreathing.toFixed(4));
    colorBreathing.style.setProperty('--filmstock-cool-opacity', state.coolBreathing.toFixed(4));

    flash.style.opacity = state.flashOpacity.toFixed(4);
    if (state.flashOpacity <= 0) return;
    flash.style.backgroundColor = state.flashBright ? '#ffe9bd' : '#120a08';
    flash.style.mixBlendMode = state.flashBright ? 'screen' : 'multiply';
  }

  function paintDust(state: FrameState): void {
    for (let i = 0; i < dust.specks.length; i += 1) {
      const speck = dust.specks[i];
      if (i >= state.speckCount) {
        speck.style.display = 'none';
        continue;
      }
      const slot = i * 4;
      speck.style.display = '';
      speck.setAttribute('cx', state.specks[slot].toFixed(1));
      speck.setAttribute('cy', state.specks[slot + 1].toFixed(1));
      speck.setAttribute('r', state.specks[slot + 2].toFixed(2));
      speck.style.opacity = state.specks[slot + 3].toFixed(3);
    }

    if (state.scratchOpacity <= 0) {
      dust.scratch.style.display = 'none';
      return;
    }
    dust.scratch.style.display = '';
    dust.scratch.setAttribute('x', state.scratch[0].toFixed(1));
    dust.scratch.setAttribute('y', state.scratch[1].toFixed(1));
    dust.scratch.setAttribute('width', state.scratch[2].toFixed(2));
    dust.scratch.setAttribute('height', state.scratch[3].toFixed(1));
    dust.scratch.style.opacity = state.scratchOpacity.toFixed(3);
  }

  applyOptions();

  return {
    paint(video: HTMLVideoElement, state: FrameState): void {
      if (destroyed || boxWidth <= 0 || boxHeight <= 0) return;

      drawCover(frameContext, frameCanvas, video);
      if (!halationCanvas.hidden) drawCover(halationContext, halationCanvas, video);
      if (!grainCanvas.hidden) drawCover(grainContext, grainCanvas, video);

      // Exposure rides on the filter list rather than on opacity: it has to
      // multiply the graded frame, not fade it towards the poster.
      const brightness = `brightness(${state.exposure.toFixed(4)})`;
      frameCanvas.style.filter = `${gradeFilter.css} ${brightness}`;
      halationCanvas.style.filter = `${halationFilter.css} ${brightness}`;
      if (!grainCanvas.hidden) grainFilter.set('noise', { seed: state.frame * 13 + 17 });

      gate.style.setProperty('--filmstock-weave-x', `${state.weaveX.toFixed(3)}px`);
      gate.style.setProperty('--filmstock-weave-y', `${state.weaveY.toFixed(3)}px`);
      gate.style.setProperty('--filmstock-weave-rotation', `${state.weaveRotation.toFixed(4)}deg`);

      paintProjector(state);
      paintDust(state);
    },

    clear(): void {
      frameContext.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
      halationContext.clearRect(0, 0, halationCanvas.width, halationCanvas.height);
      grainContext.clearRect(0, 0, grainCanvas.width, grainCanvas.height);
    },

    setOptions(next: FilmstockConfig): void {
      config = next;
      applyOptions();
    },

    resize(width: number, height: number, ratio: number): void {
      boxWidth = width;
      boxHeight = height;
      pixelRatio = ratio;
      sizeCanvas(frameCanvas, 1);
      sizeCanvas(halationCanvas, AUXILIARY_SCALE);
      sizeCanvas(grainCanvas, AUXILIARY_SCALE);
      // The bleed radius follows the box, so it is stale until this runs.
      applyOptions();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      gradeFilter.destroy();
      halationFilter.destroy();
      grainFilter.destroy();
      gate.remove();
      shutterBand.remove();
      colorBreathing.remove();
      flash.remove();
      vignette.remove();
      dustLayer.remove();
    },
  };
}

/**
 * WebGL burn renderer. The burn front is a per-pixel fbm field generated every
 * frame — the one thing in this pack that CSS, SVG filters and Canvas 2D cannot
 * express — so this is the upgrade path, never the requirement. A null return
 * means WebGL2 is unavailable and the caller must use the CSS renderer.
 */

import { createLayer, onVisible } from '../../core/dom';
import { createQuadRenderer } from '../../core/gl';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { BURN_FRAGMENT_SOURCE } from './shader';
import type { QuadRenderer } from '../../core/gl';
import type { BurnConfig, BurnMedia, BurnOrigin, BurnRendererInstance } from './index';

/** `vUv` has its origin bottom-left, so 'top' is y = 1. */
const ORIGIN_POINTS: Record<BurnOrigin, readonly [number, number]> = {
  center: [0.5, 0.5],
  left: [0, 0.5],
  right: [1, 0.5],
  top: [0.5, 1],
  bottom: [0.5, 0],
  none: [0.5, 0.5],
};

let colourProbe: CanvasRenderingContext2D | null | undefined;

/** Resolves any CSS colour to linear-free 0..1 RGB by letting the 2D context parse it. */
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

export function createWebglBurnRenderer(
  host: HTMLElement,
  initial: BurnConfig,
): BurnRendererInstance | null {
  const stack = createLayer(host, 'div', 'film-burn-stack');
  const frame = document.createElement('div');
  frame.className = 'film-burn-frame';
  const canvas = document.createElement('canvas');
  canvas.className = 'film-burn-canvas';
  frame.append(canvas);
  stack.append(frame);

  const created = createQuadRenderer(canvas, BURN_FRAGMENT_SOURCE);
  if (created === null) {
    stack.remove();
    return null;
  }
  // Rebound non-null: the per-frame closures below cannot see the guard above.
  const quad: QuadRenderer = created;

  let config = initial;
  let burnColour = parseColour(config.burnColor);
  let charColour = parseColour(config.charColor);
  let progress = 0;
  let time = 0;
  let reduced = prefersReducedMotion();
  let visible = true;
  let uploadedFrom: BurnMedia | null = null;
  let uploadedTo: BurnMedia | null = null;
  let stopTick: (() => void) | null = null;
  let destroyed = false;

  function draw(): void {
    const { from, to } = config;
    if (destroyed || from === null || to === null) return;

    quad.resize();
    if (quad.width === 0 || quad.height === 0) return;

    const fromSize: [number, number] =
      from instanceof HTMLVideoElement
        ? [from.videoWidth, from.videoHeight]
        : [from.naturalWidth, from.naturalHeight];
    const toSize: [number, number] =
      to instanceof HTMLVideoElement
        ? [to.videoWidth, to.videoHeight]
        : [to.naturalWidth, to.naturalHeight];
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

    quad.render({
      uFromSize: fromSize,
      uToSize: toSize,
      uOrigin: ORIGIN_POINTS[config.origin],
      uBurnColor: burnColour,
      uCharColor: charColour,
      uOriginBias: config.origin === 'none' ? 0 : 1,
      uProgress: progress,
      uEdge: config.edge,
      uScale: config.scale,
      uGrain: config.grain,
      uSeed: config.seed,
      uTime: time,
    });
  }

  function syncActivity(): void {
    const ready = config.from !== null && config.to !== null;
    const animating = ready && visible && !reduced && !destroyed;

    for (const media of [config.from, config.to]) {
      if (!(media instanceof HTMLVideoElement)) continue;
      if (animating) {
        void media.play().catch((error: unknown) => {
          console.warn('film-burn-transition: video playback was refused.', error);
        });
      } else {
        media.pause();
      }
    }

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

  return {
    setProgress(value: number): void {
      progress = value;
      // While the tick runs it draws anyway; this covers the frozen case.
      if (stopTick === null) draw();
    },

    setOptions(next: BurnConfig): void {
      if (next.burnColor !== config.burnColor) burnColour = parseColour(next.burnColor);
      if (next.charColor !== config.charColor) charColour = parseColour(next.charColor);
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
      stack.remove();
    },
  };
}

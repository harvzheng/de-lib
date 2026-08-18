import { createLayer, onVisible } from '../../core/dom';
import { createQuadRenderer } from '../../core/gl';
import { clamp01 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { DISSOLVE_FRAGMENT_SOURCE } from './shader';
import type { QuadRenderer } from '../../core/gl';
import type {
  DissolveConfig,
  DissolveDirection,
  DissolveMedia,
  DissolveRendererInstance,
} from './index';

const DIRECTION_VECTORS: Record<DissolveDirection, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, 1],
  down: [0, -1],
  random: [0, 0],
};

let colourProbe: CanvasRenderingContext2D | null | undefined;

function parseColour(value: string): [number, number, number] {
  if (colourProbe === undefined) {
    colourProbe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  if (colourProbe === null) return [0.5, 0.5, 0.5];
  colourProbe.fillStyle = '#808080';
  colourProbe.fillStyle = value;
  colourProbe.fillRect(0, 0, 1, 1);
  const pixel = colourProbe.getImageData(0, 0, 1, 1).data;
  return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
}

function mediaSize(media: DissolveMedia): readonly [number, number] {
  return media instanceof HTMLVideoElement
    ? [media.videoWidth, media.videoHeight]
    : [media.naturalWidth, media.naturalHeight];
}

export function createWebglDissolveRenderer(
  host: HTMLElement,
  initial: DissolveConfig,
): DissolveRendererInstance | null {
  const stack = createLayer(host, 'div', 'particulate-dissolve-stack');
  const canvas = document.createElement('canvas');
  canvas.className = 'particulate-dissolve-canvas';
  stack.append(canvas);

  const created = createQuadRenderer(canvas, DISSOLVE_FRAGMENT_SOURCE);
  if (created === null) {
    stack.remove();
    return null;
  }
  const quad: QuadRenderer = created;

  let config = initial;
  let ashColour = parseColour(config.color ?? '#808080');
  let progress = 0;
  let reduced = prefersReducedMotion();
  let visible = true;
  let uploaded: DissolveMedia | null = null;
  let stopTick: (() => void) | null = null;
  let destroyed = false;

  function draw(): void {
    if (destroyed || config.media === null) {
      canvas.hidden = true;
      return;
    }
    canvas.hidden = false;
    quad.resize();
    if (quad.width === 0 || quad.height === 0) return;

    const size = mediaSize(config.media);
    if (size[0] === 0 || size[1] === 0) return;
    if (config.media !== uploaded || config.media instanceof HTMLVideoElement) {
      quad.upload('uSource', config.media);
      uploaded = config.media;
    }

    quad.render({
      uSourceSize: size,
      uDirection: DIRECTION_VECTORS[config.direction],
      uAshColor: ashColour,
      uUseAshColor: config.color === undefined ? 0 : 1,
      uProgress: progress,
      uDrift: Math.max(0, config.drift),
      uGrain: Math.max(1, config.grain),
      uEdge: clamp01(config.edge),
      uTurbulence: clamp01(config.turbulence),
    });
  }

  function syncActivity(): void {
    const video = config.media instanceof HTMLVideoElement ? config.media : null;
    const animating = video !== null && visible && !reduced && !destroyed;
    const managedVideo = video !== null && !video.isConnected ? video : null;
    if (managedVideo !== null) {
      if (animating) {
        void managedVideo.play().catch((error: unknown) => {
          console.warn('particulate-dissolve: video playback was refused.', error);
        });
      } else {
        managedVideo.pause();
      }
    }

    if (animating && stopTick === null) {
      stopTick = onTick(() => draw());
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
    draw();
  });

  syncActivity();

  return {
    setProgress(value: number): void {
      progress = value;
      if (stopTick === null) draw();
    },

    setOptions(next: DissolveConfig): void {
      if (next.color !== config.color) ashColour = parseColour(next.color ?? '#808080');
      if (next.media !== config.media) {
        if (config.media instanceof HTMLVideoElement && !config.media.isConnected) {
          config.media.pause();
        }
        uploaded = null;
      }
      config = next;
      syncActivity();
      if (stopTick === null) draw();
    },

    resize(): void {
      draw();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopVisible();
      stopMotion();
      if (config.media instanceof HTMLVideoElement && !config.media.isConnected) config.media.pause();
      quad.dispose();
      stack.remove();
    },
  };
}

/**
 * CSS bokeh renderer — the floor that always works. One element per disc from
 * the shared list, each painted as a single radial gradient: the aperture edge is
 * a gradient stop, not a `filter: blur()`, so a disc rasterises once and every
 * frame after that is transform and opacity on an already-promoted layer.
 */

import { createLayer, onVisible } from '../../core/dom';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { discState } from './discs';
import type { BokehConfig, BokehRendererInstance } from './index';
import type { BokehDisc, DiscStateOptions } from './discs';

function discColour(disc: BokehDisc, tints: string[]): string {
  if (disc.color !== null) return `rgb(${disc.color[0]} ${disc.color[1]} ${disc.color[2]})`;
  return tints.length > 0 ? tints[disc.tint % tints.length] : '#ffffff';
}

export function createCssBokehRenderer(
  host: HTMLElement,
  initial: BokehConfig,
): BokehRendererInstance {
  const layer = createLayer(host, 'div', 'bokeh-layer');
  layer.setAttribute('aria-hidden', 'true');

  let config = initial;
  let nodes: HTMLDivElement[] = [];
  /** Per node: whether it is currently detached from compositing. */
  let culled: boolean[] = [];
  let width = 0;
  let height = 0;
  let progress = 0;
  let time = 0;
  let reduced = prefersReducedMotion();
  let visible = true;
  let stopTick: (() => void) | null = null;
  let destroyed = false;

  function stateOptions(): DiscStateOptions {
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
    if (destroyed || width === 0 || height === 0) return;
    const options = stateOptions();
    const short = Math.min(width, height);
    const discs = config.discs;

    for (let i = 0; i < discs.length; i += 1) {
      const disc = discs[i];
      const node = nodes[i];
      const state = discState(disc, progress, time, options);

      // A disc the shimmer has taken to nothing still costs a composited,
      // blended layer over everything beneath it, so it leaves the layer tree
      // instead. This bites hardest with anchored discs, which overlap by
      // construction — one lamp, several discs.
      const invisible = state.opacity < 0.015;
      if (invisible !== culled[i]) {
        node.style.display = invisible ? 'none' : 'block';
        culled[i] = invisible;
      }
      if (invisible) continue;

      const radius = disc.size * short * 0.5;
      node.style.transform = `translate3d(${(state.x - radius).toFixed(2)}px, ${(
        state.y - radius
      ).toFixed(2)}px, 0) scale(${state.scale.toFixed(3)})`;
      node.style.opacity = state.opacity.toFixed(3);
    }
  }

  /** Geometry and tint: written on rebuild and resize only, never per frame. */
  function paint(): void {
    const short = Math.min(width, height);
    for (let i = 0; i < config.discs.length; i += 1) {
      const disc = config.discs[i];
      const node = nodes[i];
      const diameter = disc.size * short;
      node.style.width = `${diameter.toFixed(2)}px`;
      node.style.height = `${diameter.toFixed(2)}px`;
      node.style.setProperty('--bokeh-tint', discColour(disc, config.tints));
    }
  }

  /** Matches the element count to the disc list; the list itself comes from `index.ts`. */
  function build(): void {
    for (let i = nodes.length; i < config.discs.length; i += 1) {
      const node = document.createElement('div');
      node.className = 'bokeh-disc';
      layer.append(node);
      nodes.push(node);
    }
    for (const extra of nodes.splice(config.discs.length)) extra.remove();
    // Rebuilt nodes start visible, so the cull flags must start there too.
    culled = nodes.map(() => false);

    paint();
  }

  function pushLook(): void {
    layer.style.setProperty('--bokeh-softness', config.softness.toFixed(3));
    layer.style.setProperty('--bokeh-rim', config.rim.toFixed(3));
  }

  function syncActivity(): void {
    // The sway and the shimmer crawl are the only time-driven terms; with
    // either switched off there is nothing to animate between scroll events.
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

  width = layer.clientWidth;
  height = layer.clientHeight;
  pushLook();
  build();
  syncActivity();
  draw();

  return {
    setProgress(value: number): void {
      progress = value;
      if (stopTick === null) draw();
    },

    setOptions(next: BokehConfig): void {
      const previous = config;
      config = next;
      pushLook();
      if (next.discs !== previous.discs || next.tints !== previous.tints) build();
      syncActivity();
      if (stopTick === null) draw();
    },

    resize(): void {
      width = layer.clientWidth;
      height = layer.clientHeight;
      paint();
      if (stopTick === null) draw();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopVisible();
      stopMotion();
      nodes = [];
      culled = [];
      layer.remove();
    },
  };
}

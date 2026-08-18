import { createLayer, onResize, onVisible } from '../../core/dom';
import { clamp01, easeOutCubic, lerp } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { onScrollProgress } from '../../core/scroll';
import { buildBurstGeometry } from './burst';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { Effect } from '../../core/types';
import type { ImpactShape } from './burst';

export type { ImpactShape } from './burst';

export interface ComicImpactOptions {
  /** Burst outline behind the target. Default 'starburst'. */
  shape?: ImpactShape;
  /** Fill colour of the burst. Default '#ffd23f'. */
  fill?: string;
  /** Outline colour. Default '#12100e'. */
  ink?: string;
  /** Outline width in px. Default 4. */
  inkWidth?: number;
  /** Number of points on the burst. Default 12. */
  points?: number;
  /** How uneven the points are, 0..1. Default 0.35. */
  irregularity?: number;
  /** Radiating speed lines behind the burst, 0..24. Default 14. */
  speedLines?: number;
  /** Offset printed shadow in px. Default 6. */
  offset?: number;
  /** Overshoot on the pop, 0..1. Default 0.45. */
  pop?: number;
  /** Shake amplitude in px during the hold. Default 3. */
  shake?: number;
  /** Rotation of the whole burst in degrees. Default -8. */
  rotation?: number;
  /** Trigger mode. Default 'inview'. */
  trigger?: 'inview' | 'scroll' | 'manual';
  /** Scroll mapping when trigger is 'scroll'. */
  scroll?: ScrollProgressOptions;
  /** Timeline duration in ms when trigger is 'inview'. Default 900. */
  duration?: number;
  /** PRNG seed; same seed, same burst. Default 1. */
  seed?: number;
}

export interface ComicImpactHandle extends Effect<ComicImpactOptions> {
  setProgress(progress: number): void;
  replay(): void;
}

type Resolved = Required<Omit<ComicImpactOptions, 'scroll'>> & Pick<ComicImpactOptions, 'scroll'>;

const DEFAULTS: Resolved = {
  shape: 'starburst',
  fill: '#ffd23f',
  ink: '#12100e',
  inkWidth: 4,
  points: 12,
  irregularity: 0.35,
  speedLines: 14,
  offset: 6,
  pop: 0.45,
  shake: 3,
  rotation: -8,
  trigger: 'inview',
  scroll: undefined,
  duration: 900,
  seed: 1,
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const ENTRY_END = 0.28;
const SETTLE_END = 0.42;
const EXIT_START = 0.76;

function resolve(base: Resolved, patch: ComicImpactOptions): Resolved {
  return {
    shape: patch.shape ?? base.shape,
    fill: patch.fill ?? base.fill,
    ink: patch.ink ?? base.ink,
    inkWidth: patch.inkWidth ?? base.inkWidth,
    points: patch.points ?? base.points,
    irregularity: patch.irregularity ?? base.irregularity,
    speedLines: patch.speedLines ?? base.speedLines,
    offset: patch.offset ?? base.offset,
    pop: patch.pop ?? base.pop,
    shake: patch.shake ?? base.shake,
    rotation: patch.rotation ?? base.rotation,
    trigger: patch.trigger ?? base.trigger,
    scroll: patch.scroll ?? base.scroll,
    duration: patch.duration ?? base.duration,
    seed: patch.seed ?? base.seed,
  };
}

export function createComicImpact(
  target: HTMLElement,
  options: ComicImpactOptions = {},
): ComicImpactHandle {
  let config = resolve(DEFAULTS, options);
  const hadTargetClass = target.classList.contains('comic-impact-target');
  const originalPosition = target.style.position;
  target.classList.add('comic-impact-target');

  const layer = createLayer(target, 'div', 'comic-impact-layer');
  layer.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'comic-impact-svg');
  const speedLineGroup = document.createElementNS(SVG_NS, 'g');
  speedLineGroup.setAttribute('class', 'comic-impact-speed-lines');
  const shadow = document.createElementNS(SVG_NS, 'path');
  shadow.setAttribute('class', 'comic-impact-shadow');
  const burst = document.createElementNS(SVG_NS, 'path');
  burst.setAttribute('class', 'comic-impact-burst');
  svg.append(speedLineGroup, shadow, burst);
  layer.append(svg);

  let width = -1;
  let height = -1;
  let progress = 0;
  let elapsed = 0;
  let visible = false;
  let playing = false;
  let played = false;
  let reduced = prefersReducedMotion();
  let stopTick: (() => void) | null = null;
  let stopScroll: (() => void) | null = null;
  let destroyed = false;

  function rebuild(): void {
    const geometry = buildBurstGeometry({
      width,
      height,
      shape: config.shape,
      points: config.points,
      irregularity: config.irregularity,
      speedLines: config.speedLines,
      seed: config.seed,
    });
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    shadow.setAttribute('d', geometry.path);
    shadow.setAttribute('fill', config.ink);
    shadow.setAttribute('transform', `translate(${config.offset} ${config.offset})`);
    burst.setAttribute('d', geometry.path);
    burst.setAttribute('fill', config.fill);
    burst.setAttribute('stroke', config.ink);
    burst.setAttribute('stroke-width', String(Math.max(0, config.inkWidth)));

    const lines = geometry.lines.map((line) => {
      const element = document.createElementNS(SVG_NS, 'line');
      element.setAttribute('class', 'comic-impact-speed-line');
      element.setAttribute('x1', String(line.x1));
      element.setAttribute('y1', String(line.y1));
      element.setAttribute('x2', String(line.x2));
      element.setAttribute('y2', String(line.y2));
      element.setAttribute('stroke', config.ink);
      element.setAttribute('stroke-width', String(Math.max(1, config.inkWidth * 0.72)));
      return element;
    });
    speedLineGroup.replaceChildren(...lines);
    svg.classList.toggle('comic-impact-svg--cloud', config.shape === 'cloud');
  }

  function paint(value: number): void {
    const amount = clamp01(value);
    if (reduced) {
      const entryOpacity = clamp01(amount / 0.1);
      const exitOpacity = clamp01((1 - amount) / 0.1);
      const opacity = config.trigger === 'inview' ? 1 : Math.min(entryOpacity, exitOpacity);
      svg.style.opacity = opacity.toFixed(3);
      svg.style.transform = `rotate(${config.rotation}deg)`;
      return;
    }

    let scale = 1;
    let opacity = 1;
    let shakeX = 0;
    let shakeY = 0;
    if (amount < ENTRY_END) {
      const entry = easeOutCubic(amount / ENTRY_END);
      scale = lerp(0.16, 1 + clamp01(config.pop), entry);
      opacity = clamp01(amount / 0.1);
    } else if (amount < SETTLE_END) {
      const settle = easeOutCubic((amount - ENTRY_END) / (SETTLE_END - ENTRY_END));
      scale = lerp(1 + clamp01(config.pop), 1, settle);
    } else if (amount < EXIT_START) {
      const hold = (amount - SETTLE_END) / (EXIT_START - SETTLE_END);
      const edge = Math.sin(Math.PI * hold);
      shakeX = Math.sin(hold * 43 + config.seed) * config.shake * edge;
      shakeY = Math.cos(hold * 37 + config.seed * 0.7) * config.shake * edge;
    } else {
      const exit = clamp01((amount - EXIT_START) / (1 - EXIT_START));
      scale = lerp(1, 0.72, exit);
      opacity = 1 - easeOutCubic(exit);
    }
    const shakeRotation = shakeX * 0.32;
    svg.style.opacity = opacity.toFixed(3);
    svg.style.transform =
      `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px) ` +
      `rotate(${(config.rotation + shakeRotation).toFixed(2)}deg) scale(${scale.toFixed(4)})`;
  }

  function syncTick(): void {
    const wanted = config.trigger === 'inview' && playing && visible && !reduced;
    if (wanted && stopTick === null) {
      stopTick = onTick((_now, deltaMs) => {
        elapsed += deltaMs;
        progress = clamp01(elapsed / Math.max(1, config.duration));
        paint(progress);
        if (progress >= 1) {
          playing = false;
          syncTick();
        }
      });
    } else if (!wanted && stopTick !== null) {
      stopTick();
      stopTick = null;
    }
  }

  function commitProgress(value: number): void {
    progress = clamp01(value);
    paint(progress);
  }

  function syncScroll(): void {
    stopScroll?.();
    stopScroll =
      config.trigger === 'scroll'
        ? onScrollProgress(target, commitProgress, config.scroll)
        : null;
  }

  syncScroll();

  const stopResize = onResize(target, (nextWidth, nextHeight) => {
    const roundedWidth = Math.round(nextWidth);
    const roundedHeight = Math.round(nextHeight);
    if (roundedWidth === width && roundedHeight === height) return;
    width = roundedWidth;
    height = roundedHeight;
    rebuild();
    paint(reduced && config.trigger === 'inview' ? 0.5 : progress);
  });

  const stopVisible = onVisible(target, (isVisible) => {
    visible = isVisible;
    if (visible && config.trigger === 'inview' && !played) {
      played = true;
      playing = true;
      elapsed = 0;
      progress = 0;
      paint(0);
    }
    syncTick();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    if (reduced) {
      playing = false;
      syncTick();
      paint(config.trigger === 'inview' ? 0.5 : progress);
      return;
    }
    if (config.trigger === 'inview' && visible) {
      elapsed = 0;
      progress = 0;
      playing = true;
      played = true;
    }
    paint(progress);
    syncTick();
  });

  return {
    setOptions(patch: Partial<ComicImpactOptions>): void {
      if (destroyed) return;
      config = resolve(config, patch);
      elapsed = 0;
      progress = 0;
      played = config.trigger !== 'inview';
      playing = config.trigger === 'inview' && visible;
      if (playing) played = true;
      if (width >= 0) rebuild();
      syncScroll();
      paint(reduced && config.trigger === 'inview' ? 0.5 : progress);
      syncTick();
    },

    setProgress(value: number): void {
      if (destroyed) return;
      commitProgress(value);
    },

    replay(): void {
      if (destroyed) return;
      elapsed = 0;
      progress = 0;
      paint(reduced && config.trigger === 'inview' ? 0.5 : 0);
      if (config.trigger === 'inview') {
        playing = visible && !reduced;
        played = playing;
      }
      syncTick();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopScroll?.();
      stopScroll = null;
      stopResize();
      stopVisible();
      stopMotion();
      layer.remove();
      target.style.position = originalPosition;
      if (!hadTargetClass) target.classList.remove('comic-impact-target');
    },
  };
}

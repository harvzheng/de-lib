import { createLayer, onVisible } from '../../core/dom';
import { clamp, clamp01 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { onScrollProgress } from '../../core/scroll';
import { createFilter } from '../../core/svg';
import { buildSubwayLightGeometry } from './lights';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { FilterHandle } from '../../core/svg';
import type { Effect } from '../../core/types';
import type { SubwayLightGeometry } from './lights';

export type SubwayPerspective = 'window' | 'platform';

export interface SubwayMotionOptions {
  /** Default 'window'. */
  perspective?: SubwayPerspective;
  /** Travel rate. 1 runs at line speed; 0 holds the current frame. Default 1. */
  speed?: number;
  /** Overall strength of the treatment, 0..1. Default 0.8. */
  intensity?: number;
  /** How dark the carriage/night grade pulls the content, 0..1. Default 0.55. */
  darkness?: number;
  /** Passing light density, 0..1. Default 0.5. */
  lights?: number;
  /** Colour of the passing lights. Default '#ffd27a'. */
  lightColor?: string;
  /** Reflection of the interior in the glass, 0..1. 'window' only. Default 0.4. */
  reflection?: number;
  /** Rain-streaked glass distortion via feTurbulence displacement, 0..1. 'window' only. Default 0. */
  rain?: number;
  /** Station wash on 'window', headlight spill on 'platform', 0..1. Default 0.35. */
  flashes?: number;
  /** Vertical shake of the carriage, 0..1. Default 0.3. */
  rumble?: number;
  /** Scroll mapping. When set, travel is scrubbed by scroll instead of running on a clock. */
  scroll?: ScrollProgressOptions;
  /** PRNG seed; same seed, same light pattern. Default 1. */
  seed?: number;
}

export interface SubwayMotionHandle extends Effect<SubwayMotionOptions> {
  /** Drives travel manually, 0..1, when `scroll` is set. */
  setProgress(progress: number): void;
}

interface ResolvedOptions {
  perspective: SubwayPerspective;
  speed: number;
  intensity: number;
  darkness: number;
  lights: number;
  lightColor: string;
  reflection: number;
  rain: number;
  flashes: number;
  rumble: number;
  scroll?: ScrollProgressOptions;
  seed: number;
}

interface WindowLayers {
  kind: 'window';
  grade: HTMLDivElement;
  far: HTMLDivElement;
  lamps: HTMLDivElement;
  near: HTMLDivElement;
  station: HTMLDivElement;
  reflection: HTMLDivElement;
  glass: HTMLDivElement;
  frame: HTMLDivElement;
}

interface PlatformLayers {
  kind: 'platform';
  grade: HTMLDivElement;
  streaks: HTMLDivElement;
  train: HTMLDivElement;
  spill: HTMLDivElement;
}

type Layers = WindowLayers | PlatformLayers;

const DEFAULTS: ResolvedOptions = {
  perspective: 'window',
  speed: 1,
  intensity: 0.8,
  darkness: 0.55,
  lights: 0.5,
  lightColor: '#ffd27a',
  reflection: 0.4,
  rain: 0,
  flashes: 0.35,
  rumble: 0.3,
  seed: 1,
};

const CYCLE_MS = 7000;
/** Host widths of tunnel travelled per cycle, per depth band. Integers only:
 *  a fractional count lands the strip mid-tile at the wrap and cuts a seam. */
const FAR_TILES = 2;
const LAMP_TILES = 6;
const NEAR_TILES = 12;
/** Half-width of a station event in cycle space — wide enough that the wash
 *  swells and passes rather than blinking. */
const STATION_SPAN = 0.075;
/** The train strip is five carriages, each one host width. */
const TRAIN_HOSTS = 5;
/** Host-width position of the train's leading edge at progress 0, and the
 *  distance it covers over one cycle. The extra beyond 5 + 1 host widths is the
 *  clear platform either side of the pass. */
const TRAIN_HEAD_START = 125;
const TRAIN_SWEEP = 650;
/** Held frames for reduced motion. 'window' sits between lamp runs; 'platform'
 *  parks the leading carriage in the right of the frame, leaving the host
 *  content readable across the rest of it. */
const WINDOW_HELD_PROGRESS = 0.37;
const PLATFORM_HELD_PROGRESS = 0.103;

const RAIN_FILTER = `
  <filter x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
    <feTurbulence data-p="turbulence" type="fractalNoise" baseFrequency="0.008 0.12" numOctaves="2" seed="1" result="rain-noise" />
    <feDisplacementMap data-p="displace" in="SourceGraphic" in2="rain-noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
  </filter>
`;

function resolve(base: ResolvedOptions, patch: SubwayMotionOptions): ResolvedOptions {
  return {
    perspective: patch.perspective ?? base.perspective,
    speed: Math.max(0, patch.speed ?? base.speed),
    intensity: clamp01(patch.intensity ?? base.intensity),
    darkness: clamp01(patch.darkness ?? base.darkness),
    lights: clamp01(patch.lights ?? base.lights),
    lightColor: patch.lightColor ?? base.lightColor,
    reflection: clamp01(patch.reflection ?? base.reflection),
    rain: clamp01(patch.rain ?? base.rain),
    flashes: clamp01(patch.flashes ?? base.flashes),
    rumble: clamp01(patch.rumble ?? base.rumble),
    scroll: patch.scroll ?? base.scroll,
    seed: Math.trunc(patch.seed ?? base.seed),
  };
}

function addLayer(parent: HTMLElement, className: string): HTMLDivElement {
  const layer = createLayer(parent, 'div', className);
  layer.setAttribute('aria-hidden', 'true');
  return layer;
}

/** `createLayer` writes inset/width/height inline, which outranks `effect.css`;
 *  every layer wider or shorter than the host has to be sized from here. */
function stretch(layer: HTMLDivElement, widthPercent: number): void {
  layer.style.right = 'auto';
  layer.style.width = `${widthPercent}%`;
}

function band(layer: HTMLDivElement, topPercent: number, bottomPercent: number): void {
  layer.style.height = 'auto';
  layer.style.top = `${topPercent}%`;
  layer.style.bottom = `${bottomPercent}%`;
}

function wrap(value: number): number {
  return ((value % 1) + 1) % 1;
}

/** A strip is 400% wide over 25% tiles, so a -25% step advances exactly one
 *  tile: with an integer `tiles` the loop closes invisibly at the cycle wrap. */
function stripTransform(progress: number, tiles: number, phase: number): string {
  return `translate3d(${(-25 * wrap(progress * tiles + phase)).toFixed(3)}%, 0, 0)`;
}

/** Signed −1..1 position through the nearest station event, saturating outside
 *  one so the wash contributes nothing between stations. */
function stationPhase(progress: number, points: readonly number[]): number {
  let nearest = 2;
  for (const point of points) {
    let delta = progress - point;
    if (delta > 0.5) delta -= 1;
    else if (delta < -0.5) delta += 1;
    if (Math.abs(delta) < Math.abs(nearest)) nearest = delta;
  }
  return clamp(nearest / STATION_SPAN, -1, 1);
}

export function createSubwayMotion(
  host: HTMLElement,
  options: SubwayMotionOptions = {},
): SubwayMotionHandle {
  let config = resolve(DEFAULTS, options);
  let geometry: SubwayLightGeometry = buildSubwayLightGeometry(config.seed, config.lights);
  const stage = addLayer(host, 'subway-motion-stage');

  let layers: Layers;
  let rainFilter: FilterHandle | null = null;
  let reduced = prefersReducedMotion();
  let visible = true;
  let destroyed = false;
  let stopTick: (() => void) | null = null;
  let stopScroll: (() => void) | null = null;

  function frozen(): boolean {
    return reduced && config.scroll === undefined;
  }

  function heldProgress(): number {
    return config.perspective === 'window' ? WINDOW_HELD_PROGRESS : PLATFORM_HELD_PROGRESS;
  }

  let progress = frozen() ? heldProgress() : 0;

  function buildWindowLayers(): WindowLayers {
    stage.className = 'subway-motion-stage subway-motion-stage--window';
    const grade = addLayer(stage, 'subway-motion-grade');
    const far = addLayer(stage, 'subway-motion-strip subway-motion-strip--far');
    const lamps = addLayer(stage, 'subway-motion-strip subway-motion-strip--lamp');
    const near = addLayer(stage, 'subway-motion-strip subway-motion-strip--near');
    const station = addLayer(stage, 'subway-motion-station');
    const reflection = addLayer(stage, 'subway-motion-reflection');
    const glass = addLayer(stage, 'subway-motion-glass');
    const frame = addLayer(stage, 'subway-motion-frame');

    stretch(far, 400);
    stretch(lamps, 400);
    stretch(near, 400);
    stretch(station, 180);
    // Each strip is cropped to the band its mask keeps, so nothing pays to paint,
    // blur or composite the host height either side of it. The mask stops in
    // `effect.css` are fractions of these boxes.
    band(far, 38, 42);
    band(lamps, 12, 22);
    band(near, 75, 2);
    // The aperture is inset from the host edge so the carriage wall reads around it.
    frame.style.width = 'auto';
    frame.style.left = '2.4%';
    frame.style.right = '2.4%';
    band(frame, 3, 3);
    return { kind: 'window', grade, far, lamps, near, station, reflection, glass, frame };
  }

  function buildPlatformLayers(): PlatformLayers {
    stage.className = 'subway-motion-stage subway-motion-stage--platform';
    const grade = addLayer(stage, 'subway-motion-grade');
    const streaks = addLayer(stage, 'subway-motion-platform-streaks');
    const train = addLayer(stage, 'subway-motion-train');
    const spill = addLayer(stage, 'subway-motion-station subway-motion-station--platform');

    stretch(train, TRAIN_HOSTS * 100);
    // The floor reflection shares the train's width and travel so its repeat
    // period stays locked to the carriage pitch.
    stretch(streaks, TRAIN_HOSTS * 100);
    stretch(spill, 160);
    // The body occupies a horizontal band, not the whole frame: host content
    // stays visible above the roof and below the skirt so it reads as a vehicle.
    band(train, 30, 36);
    band(streaks, 62, 8);
    return { kind: 'platform', grade, streaks, train, spill };
  }

  function destroyRainFilter(): void {
    rainFilter?.destroy();
    rainFilter = null;
  }

  function syncRainFilter(): void {
    if (layers.kind !== 'window' || config.rain <= 0) {
      destroyRainFilter();
      if (layers.kind === 'window') layers.glass.style.filter = '';
      return;
    }

    if (rainFilter === null) rainFilter = createFilter(RAIN_FILTER, 'subway-motion-rain');
    rainFilter.set('turbulence', { seed: config.seed });
    rainFilter.set('displace', { scale: (config.rain * 18).toFixed(2) });
    layers.glass.style.filter = rainFilter.css;
  }

  function applyStyleVars(): void {
    stage.style.setProperty('--subway-motion-light-color', config.lightColor);
    // Motion smear, in host-width percent. Tails grow with speed so faster looks
    // faster instead of only repeating sooner.
    stage.style.setProperty(
      '--subway-motion-tail',
      `${Math.min(0.3 + config.speed * 1.2, 4.2).toFixed(3)}%`,
    );
    stage.style.setProperty(
      '--subway-motion-shade',
      `${((0.34 + config.darkness * 0.62) * 100).toFixed(1)}%`,
    );
  }

  function applyGeometry(): void {
    if (layers.kind !== 'window') return;
    layers.far.style.backgroundImage = geometry.farGradient;
    layers.lamps.style.backgroundImage = geometry.lampGradient;
    layers.near.style.backgroundImage = geometry.nearGradient;
  }

  function renderWindow(windowLayers: WindowLayers, held: boolean): void {
    windowLayers.far.style.transform = stripTransform(progress, FAR_TILES, geometry.farPhase);
    windowLayers.lamps.style.transform = stripTransform(progress, LAMP_TILES, geometry.lampPhase);
    windowLayers.near.style.transform = stripTransform(progress, NEAR_TILES, geometry.nearPhase);

    windowLayers.grade.style.opacity = String(config.intensity * config.darkness);
    windowLayers.far.style.opacity = String(config.intensity * config.lights * 0.55);
    windowLayers.lamps.style.opacity = String(clamp01(config.intensity * config.lights * 1.35));
    windowLayers.near.style.opacity = String(config.intensity * config.lights * 0.4);
    windowLayers.reflection.style.opacity = String(config.intensity * config.reflection);
    windowLayers.glass.style.opacity = String(config.intensity * config.rain);
    windowLayers.frame.style.opacity = String(config.intensity);

    // Held frames pick a station mid-pass: a composed "pulling in" frame reads
    // better than an arbitrary stretch of dark tunnel.
    const phase = held ? -0.2 : stationPhase(progress, geometry.stationPoints);
    const level = (1 - Math.abs(phase)) ** 1.5;
    const swell = 0.66 + level * 0.6;
    // The wash element is 180% of the host, so its rest centre is at 90%.
    const centre = 52 - phase * 116;
    windowLayers.station.style.transform =
      `translate3d(${((centre - 90) / 1.8).toFixed(3)}%, 0, 0) scale3d(${swell.toFixed(3)}, ${swell.toFixed(3)}, 1)`;
    windowLayers.station.style.opacity = String(clamp01(config.intensity * config.flashes * level * 2.4));
  }

  function renderPlatform(platformLayers: PlatformLayers, held: boolean, rumble: number): void {
    // The seed offsets the pass so two instances on one page are not in lockstep.
    const travel = held ? PLATFORM_HELD_PROGRESS : wrap(progress + geometry.lampPhase);
    const head = TRAIN_HEAD_START - travel * TRAIN_SWEEP;
    const sweep = `translate3d(${(head / TRAIN_HOSTS).toFixed(3)}%, ${rumble.toFixed(3)}px, 0)`;
    platformLayers.train.style.transform = sweep;
    platformLayers.streaks.style.transform = sweep;

    platformLayers.grade.style.opacity = String(config.intensity * config.darkness * 0.82);
    platformLayers.train.style.opacity = String(Math.min(1, config.intensity * 1.3));
    platformLayers.streaks.style.opacity = String(config.intensity * config.lights * 0.85);

    // Spill tracks the leading edge, so it reads as the train's own light
    // sweeping the platform rather than an unattached flash.
    const crossing = clamp01(1 - Math.abs(head - 42) / 150) ** 1.4;
    platformLayers.spill.style.transform = `translate3d(${((head - 34 - 80) / 1.6).toFixed(3)}%, 0, 0)`;
    platformLayers.spill.style.opacity = String(clamp01(config.intensity * config.flashes * crossing * 2.2));
  }

  function render(): void {
    const held = frozen();
    // Rumble counts track joints, so it is a function of distance travelled and
    // stiffens with speed for free.
    const rumble = held
      ? 0
      : (Math.sin(progress * Math.PI * 94) + Math.sin(progress * Math.PI * 226) * 0.38) *
        config.rumble *
        config.intensity *
        3.2;

    if (layers.kind === 'window') {
      // From inside the carriage the whole view shakes; from the platform only
      // the train does, so the stage stays still there.
      stage.style.transform = `translate3d(0, ${rumble.toFixed(3)}px, 0)`;
      renderWindow(layers, held);
    } else {
      stage.style.transform = '';
      renderPlatform(layers, held, rumble);
    }
  }

  function rebuildPerspective(): void {
    destroyRainFilter();
    stage.replaceChildren();
    layers = config.perspective === 'window' ? buildWindowLayers() : buildPlatformLayers();
    if (frozen()) progress = heldProgress();
    applyStyleVars();
    applyGeometry();
    syncRainFilter();
    render();
  }

  function applyProgress(value: number): void {
    progress = clamp01(value);
    render();
  }

  function tickAnimation(_now: number, deltaMs: number): void {
    progress = wrap(progress + (deltaMs / CYCLE_MS) * config.speed);
    render();
  }

  function syncActivity(): void {
    const wanted = config.scroll === undefined && !reduced && visible && config.speed > 0 && config.intensity > 0;
    if (wanted && stopTick === null) stopTick = onTick(tickAnimation);
    else if (!wanted && stopTick !== null) {
      stopTick();
      stopTick = null;
    }
  }

  function syncScroll(): void {
    stopScroll?.();
    stopScroll = config.scroll === undefined ? null : onScrollProgress(host, applyProgress, config.scroll);
  }

  layers = config.perspective === 'window' ? buildWindowLayers() : buildPlatformLayers();
  applyStyleVars();
  applyGeometry();
  syncRainFilter();
  render();
  syncScroll();
  syncActivity();

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncActivity();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    if (frozen()) progress = heldProgress();
    render();
    syncActivity();
  });

  return {
    setOptions(patch: Partial<SubwayMotionOptions>): void {
      if (destroyed) return;
      const perspectiveChanged = patch.perspective !== undefined && patch.perspective !== config.perspective;
      const geometryChanged =
        (patch.seed !== undefined && Math.trunc(patch.seed) !== config.seed) ||
        (patch.lights !== undefined && clamp01(patch.lights) !== config.lights);
      const scrollChanged = patch.scroll !== undefined && patch.scroll !== config.scroll;

      config = resolve(config, patch);
      if (geometryChanged) geometry = buildSubwayLightGeometry(config.seed, config.lights);
      if (perspectiveChanged) rebuildPerspective();
      else {
        applyStyleVars();
        if (geometryChanged) applyGeometry();
        if (patch.rain !== undefined || patch.seed !== undefined) syncRainFilter();
        render();
      }
      if (scrollChanged) syncScroll();
      syncActivity();
    },

    setProgress(value: number): void {
      if (destroyed || config.scroll === undefined) return;
      applyProgress(value);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopTick?.();
      stopTick = null;
      stopScroll?.();
      stopScroll = null;
      stopVisible();
      stopMotion();
      destroyRainFilter();
      stage.remove();
    },
  };
}

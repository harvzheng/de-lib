/**
 * Street Light — one lamp standing still, and the host's content walking under
 * it. The reader scrolls, the page passes beneath the lamp, and whatever is under
 * the lamp *right now* comes up warm and contrasty while everything above and
 * below it sits in cold blue-grey. The lamp itself never moves in the reader's
 * frame; the page does.
 *
 * The illumination is real, in the sense that it is the host's pixels being
 * brightened and darkened rather than a yellow disc painted over them: night in
 * `multiply` masked open over the throw, contrast in `overlay` inside it, light
 * in `screen` on top, mist in `screen` above that — each blending against the
 * host's own content. Nothing here isolates, because isolating is exactly what
 * would turn those blend modes into flat paint (see `effect.css`).
 *
 * Every layer is a band pinned to the viewport, with its gradients laid out once
 * in band coordinates by `lamp.ts`. Scroll writes nothing but a `translate3d` on
 * each band, so a scroll scrub is a composite rather than four host-sized
 * gradient repaints; sway is another term in the same transform, and buzz is an
 * opacity. Keeping paint out of the scroll path is the whole reason the layout
 * is split this way — do not move a gradient's geometry onto the progress path.
 */

import { createLayer, onResize, onVisible } from '../../core/dom';
import { clamp01 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { onTick } from '../../core/raf';
import { onScrollProgress } from '../../core/scroll';
import { bandOffset, buzzGain, lampRig, swayShift } from './lamp';
import type { ScrollProgressOptions } from '../../core/scroll';
import type { Effect } from '../../core/types';
import type { Box, Ellipse } from './lamp';

export interface StreetLightOptions {
  /** Scroll mapping. Default `{ start: 1, end: 0 }` — the host's whole travel through the viewport. Pass false to drive progress yourself. */
  scroll?: ScrollProgressOptions | false;
  /** Progress when `scroll` is false, 0..1. Default 0. */
  progress?: number;
  /** Viewport fraction the lamp's lens holds. Default 0.24. */
  anchor?: number;
  /** Host-x fraction the lamp stands at. Default 0.4. */
  column?: number;
  /** How far below the lens the throw lands, as a fraction of viewport height. Default 0.3. */
  drop?: number;
  /** Pool half-width as a fraction of the lesser of host width and viewport height. Default 0.19. */
  spread?: number;
  /** Pool length over pool width, floored at 1. Default 1.45. */
  stretch?: number;
  /** Strength of the illumination under the lamp, 0..1. Default 0.9. */
  glow?: number;
  /** Depth of the night everywhere else, 0..1. Default 0.82. */
  depth?: number;
  /** Lamp colour: sodium orange through to LED white. Default '#ffc27a'. */
  light?: string;
  /** Colour of the night. Night is blue, not black. Default '#4a5c80'. */
  night?: string;
  /** Draw the fixture — mast, arm and head. Default true. */
  fixture?: boolean;
  /** Mist in the air between lens and ground, 0..1. Default 0; nonzero adds a fourth backdrop blend. */
  cone?: number;
  /** Sway amplitude in px — a lamp on a wire in wind. Default 0; nonzero enables motion. */
  sway?: number;
  /** Mains buzz depth, 0..1. Default 0; nonzero enables motion. */
  buzz?: number;
}

export interface StreetLightHandle extends Effect<StreetLightOptions> {
  /** Walks the host under the lamp by hand, 0..1. Only meaningful when `scroll` is false. */
  setProgress(progress: number): void;
  /** How far the host has walked under the lamp. Demo-facing readout. */
  readonly progress: number;
}

type Resolved = Required<StreetLightOptions>;

const DEFAULTS: Resolved = {
  scroll: { start: 1, end: 0 },
  progress: 0,
  anchor: 0.24,
  column: 0.4,
  drop: 0.3,
  spread: 0.19,
  stretch: 1.45,
  glow: 0.9,
  depth: 0.82,
  light: '#ffc27a',
  night: '#4a5c80',
  fixture: true,
  cone: 0,
  sway: 0,
  buzz: 0,
};

/**
 * Sway and buzz are resampled at 24 Hz rather than every frame. Both are cheap
 * now — a transform and an opacity — but a five-second swing has nothing above
 * 24 Hz in it, so the extra frames would be pure work for no picture. Buzz is
 * sampled at the same step; see `buzzGain` for why a faithful 100 Hz hum is not
 * the thing being drawn.
 */
const TIME_STEP_MS = 1000 / 24;
const SWAY_PERIOD_MS = 5200;

/**
 * The mapping `bandOffset` inverts when the caller has taken progress over.
 * `scroll: false` carries no mapping of its own, so hand-driven progress is read
 * against the default one — which is what makes it reproduce scroll-driven
 * placement exactly.
 */
const MANUAL_SCROLL = { start: 1, end: 0 };

function resolve(base: Resolved, patch: StreetLightOptions): Resolved {
  return {
    scroll: patch.scroll ?? base.scroll,
    progress: patch.progress ?? base.progress,
    anchor: patch.anchor ?? base.anchor,
    column: patch.column ?? base.column,
    drop: patch.drop ?? base.drop,
    spread: patch.spread ?? base.spread,
    stretch: patch.stretch ?? base.stretch,
    glow: patch.glow ?? base.glow,
    depth: patch.depth ?? base.depth,
    light: patch.light ?? base.light,
    night: patch.night ?? base.night,
    fixture: patch.fixture ?? base.fixture,
    cone: patch.cone ?? base.cone,
    sway: patch.sway ?? base.sway,
    buzz: patch.buzz ?? base.buzz,
  };
}

export function createStreetLight(
  host: HTMLElement,
  options: StreetLightOptions = {},
): StreetLightHandle {
  let config = resolve(DEFAULTS, options);

  const hostPositionBefore = host.style.position;
  const stack = createLayer(host, 'div', 'street-light-stack');
  stack.setAttribute('aria-hidden', 'true');

  // Paint order is DOM order: night first, then the fixture, then contrast, then
  // the light itself, then the mist in the air above all of it. The fixture sits
  // above the night rather than under it because hardware that has already been
  // multiplied by a deep night is indistinguishable from the ground it stands
  // over — and a lamp you cannot see is the thing this effect got wrong before.
  const night = document.createElement('div');
  night.className = 'street-light-night street-light-band';

  const fixture = document.createElement('div');
  fixture.className = 'street-light-fixture';
  for (const part of ['mast', 'arm', 'head']) {
    const element = document.createElement('div');
    element.className = `street-light-${part}`;
    fixture.appendChild(element);
  }

  const lit = document.createElement('div');
  lit.className = 'street-light-lit street-light-throw';
  const glow = document.createElement('div');
  glow.className = 'street-light-glow street-light-throw';
  const cone = document.createElement('div');
  cone.className = 'street-light-cone';

  stack.append(night, fixture, lit, glow, cone);
  for (const layer of [fixture, night, lit, glow, cone]) {
    layer.setAttribute('aria-hidden', 'true');
  }

  /** Layers that carry light, and therefore ride the pool's share of the sway. */
  const poolLayers = [night, lit, glow];

  let width = 0;
  let height = 0;
  let viewportHeight = 0;
  let progress = clamp01(config.scroll === false ? config.progress : 0);
  let placementScroll: ScrollProgressOptions =
    config.scroll === false ? MANUAL_SCROLL : config.scroll;
  let reduced = prefersReducedMotion();
  let visible = true;
  let elapsedMs = 0;
  let stepMs = 0;
  let headSway = { x: 0, y: 0 };
  let poolSway = { x: 0, y: 0 };
  let stopTick: (() => void) | null = null;
  let stopScroll: (() => void) | null = null;
  let destroyed = false;

  function writeEllipse(name: string, ellipse: Ellipse): void {
    stack.style.setProperty(`--sl-${name}-x`, ellipse.x.toFixed(1));
    stack.style.setProperty(`--sl-${name}-y`, ellipse.y.toFixed(1));
    stack.style.setProperty(`--sl-${name}-a`, ellipse.across.toFixed(1));
    stack.style.setProperty(`--sl-${name}-b`, ellipse.along.toFixed(1));
  }

  function writeBox(name: string, box: Box): void {
    stack.style.setProperty(`--sl-${name}-x`, box.x.toFixed(1));
    stack.style.setProperty(`--sl-${name}-y`, box.y.toFixed(1));
    stack.style.setProperty(`--sl-${name}-w`, box.width.toFixed(1));
    stack.style.setProperty(`--sl-${name}-h`, box.height.toFixed(1));
  }

  /** Everything the layers paint. Written on option and size changes only. */
  function writeRig(): void {
    const rig = lampRig({
      width,
      viewportHeight,
      anchor: config.anchor,
      column: config.column,
      drop: config.drop,
      spread: config.spread,
      stretch: config.stretch,
    });

    stack.style.setProperty('--sl-band', rig.height.toFixed(1));
    stack.style.setProperty('--sl-lens-x', rig.lensX.toFixed(1));
    stack.style.setProperty('--sl-lens-y', rig.lensY.toFixed(1));
    writeEllipse('hot', rig.hotspot);
    writeEllipse('pool', rig.pool);
    writeEllipse('tail', rig.tail);

    stack.style.setProperty('--sl-side', String(rig.fixture.side));
    stack.style.setProperty('--sl-arm', rig.fixture.armLength.toFixed(1));
    stack.style.setProperty('--sl-arm-thickness', rig.fixture.armThickness.toFixed(1));
    stack.style.setProperty('--sl-mast-thickness', rig.fixture.mastThickness.toFixed(1));
    writeBox('fixture', rig.fixtureBox);
    stack.style.setProperty('--sl-head-w', rig.fixture.headWidth.toFixed(1));
    stack.style.setProperty('--sl-head-h', rig.fixture.headHeight.toFixed(1));

    writeBox('throw', rig.throwBox);
    writeBox('cone', rig.coneBox);
    stack.style.setProperty('--sl-cone-half', `${rig.coneHalfAngle.toFixed(2)}deg`);
    stack.style.setProperty('--sl-cone-length', rig.coneLength.toFixed(1));
  }

  /**
   * The only thing scroll touches. Two transforms, because the pool at the far
   * end of the throw swings further on the wire than the head does — and both
   * are transforms on elements that are already their own compositing group, so
   * neither costs a repaint.
   */
  function writePlacement(): void {
    const y = bandOffset({
      height,
      viewportHeight,
      progress,
      scrollStart: placementScroll.start ?? 1,
      scrollEnd: placementScroll.end ?? 0,
    });

    const head = `translate3d(${headSway.x.toFixed(1)}px, ${(y + headSway.y).toFixed(1)}px, 0)`;
    fixture.style.transform = head;
    cone.style.transform = head;
    const pool = `translate3d(${poolSway.x.toFixed(1)}px, ${(y + poolSway.y).toFixed(1)}px, 0)`;
    for (const layer of poolLayers) layer.style.transform = pool;
  }

  function applyOptions(): void {
    stack.style.setProperty('--sl-light', config.light);
    stack.style.setProperty('--sl-night', config.night);
    stack.style.setProperty('--sl-depth', config.depth.toFixed(3));
    stack.style.setProperty('--sl-glow', config.glow.toFixed(3));
    stack.style.setProperty('--sl-cone', config.cone.toFixed(3));
    fixture.style.display = config.fixture ? '' : 'none';
    cone.style.display = config.cone > 0 ? '' : 'none';
  }

  function tickAnimation(_now: number, deltaMs: number): void {
    elapsedMs += deltaMs;
    stepMs += deltaMs;
    if (stepMs < TIME_STEP_MS) return;
    stepMs %= TIME_STEP_MS;

    if (config.sway > 0) {
      const shift = swayShift(elapsedMs, config.sway, SWAY_PERIOD_MS);
      headSway = shift.head;
      poolSway = shift.pool;
      writePlacement();
    }
    if (config.buzz > 0) {
      stack.style.setProperty('--sl-buzz', buzzGain(elapsedMs, config.buzz).toFixed(3));
    }
  }

  /**
   * Reduced motion stops the sway and the buzz and holds the lamp at rest — a
   * static frame of a lit street, not an unlit one. Scroll keeps driving the
   * band: that is the reader's own hand on the page, not autonomous motion.
   */
  function syncActivity(): void {
    const wanted = !reduced && visible && (config.sway > 0 || config.buzz > 0);
    if (wanted === (stopTick !== null)) return;

    if (!wanted) {
      stopTick?.();
      stopTick = null;
      headSway = { x: 0, y: 0 };
      poolSway = { x: 0, y: 0 };
      stack.style.setProperty('--sl-buzz', '1');
      writePlacement();
      return;
    }
    stopTick = onTick(tickAnimation);
  }

  function syncScroll(): void {
    stopScroll?.();
    if (config.scroll === false) {
      stopScroll = null;
      return;
    }
    stopScroll = onScrollProgress(
      host,
      (value) => {
        if (measure()) writeRig();
        progress = value;
        writePlacement();
      },
      config.scroll,
    );
  }

  /**
   * The band is sized and placed against the *viewport*, so the viewport's
   * height is as load-bearing as the host's own box. `onScrollProgress` already
   * re-measures on resize and `onResize` catches a host that reflows, so
   * `window.innerHeight` is read here rather than through a second listener.
   */
  function measure(): boolean {
    // `onResize` reports the content box, but `inset: 0` on the bands resolves
    // against the host's *padding* box, so a padded host would put the light a
    // padding's worth away from where the geometry says it is.
    const nextWidth = host.clientWidth;
    const nextHeight = host.clientHeight;
    const nextViewport = window.innerHeight;
    if (nextWidth === width && nextHeight === height && nextViewport === viewportHeight) {
      return false;
    }
    width = nextWidth;
    height = nextHeight;
    viewportHeight = nextViewport;
    return true;
  }

  const stopResize = onResize(host, () => {
    if (!measure()) return;
    writeRig();
    writePlacement();
  });

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncActivity();
  });

  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    syncActivity();
  });

  // `onResize` reports the first size asynchronously, so the opening frame is
  // measured here: a host that never resizes would otherwise paint a band sized
  // for a zero-by-zero box.
  measure();
  applyOptions();
  writeRig();
  writePlacement();
  syncScroll();
  syncActivity();

  return {
    get progress(): number {
      return progress;
    },

    setOptions(patch: StreetLightOptions): void {
      if (destroyed) return;
      config = resolve(config, patch);
      if (patch.scroll !== undefined && patch.scroll !== false) placementScroll = patch.scroll;
      applyOptions();
      if (patch.scroll !== undefined) syncScroll();
      if (patch.progress !== undefined && config.scroll === false) {
        progress = clamp01(config.progress);
      }
      writeRig();
      writePlacement();
      syncActivity();
    },

    setProgress(value: number): void {
      if (destroyed) return;
      progress = clamp01(value);
      writePlacement();
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
      stack.remove();
      host.style.position = hostPositionBefore;
    },
  };
}

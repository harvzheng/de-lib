/**
 * Renders the gallery landing page from the effect manifest, and previews each
 * effect by mounting the real thing inside its own card.
 * Demo chrome only — never imported by an effect.
 */

import './demo.css';
import './gallery.css';

// A preview mounts mid-scroll, so its stylesheet has to be here already. Each
// is a few hundred bytes of slug-namespaced rules.
import '../effects/bokeh/effect.css';
import '../effects/comic-impact/effect.css';
import '../effects/comic-print/effect.css';
import '../effects/crumpled-paper/effect.css';
import '../effects/film-burn-overlay/effect.css';
import '../effects/film-burn-transition/effect.css';
import '../effects/film-grain-video/effect.css';
import '../effects/light-leak-transition/effect.css';
import '../effects/neon-sign/effect.css';
import '../effects/particulate-dissolve/effect.css';
import '../effects/ripped-page/effect.css';
import '../effects/scribble-highlight/effect.css';
import '../effects/street-light/effect.css';
import '../effects/subway-motion/effect.css';
import '../effects/wiggly-text/effect.css';

import { createBokeh } from '../effects/bokeh';
import { createComicImpact } from '../effects/comic-impact';
import { createComicPrint } from '../effects/comic-print';
import { createCrumpledPaper } from '../effects/crumpled-paper';
import { createFilmBurnOverlay } from '../effects/film-burn-overlay';
import { createFilmBurnTransition } from '../effects/film-burn-transition';
import { createFilmGrainVideo } from '../effects/film-grain-video';
import { createLightLeakTransition } from '../effects/light-leak-transition';
import { EFFECTS } from '../effects/manifest';
import { createNeonSign } from '../effects/neon-sign';
import { createParticulateDissolve } from '../effects/particulate-dissolve';
import { createRippedPage } from '../effects/ripped-page';
import { createScribbleHighlight } from '../effects/scribble-highlight';
import { createStreetLight } from '../effects/street-light';
import { createSubwayMotion } from '../effects/subway-motion';
import { createWigglyText } from '../effects/wiggly-text';
import type { EffectHandle } from '../core/types';
import type { EffectCategory, EffectMeta, EffectTech } from '../effects/manifest';

const CATEGORY_ORDER: readonly EffectCategory[] = ['transition', 'background', 'overlay', 'annotation'];

const CATEGORY_LABELS: Record<EffectCategory, string> = {
  transition: 'Transitions',
  background: 'Backgrounds',
  overlay: 'Overlays',
  annotation: 'Annotations',
};

const TECH_LABELS: Record<EffectTech, string> = {
  webgl: 'WebGL',
  svg: 'SVG',
  css: 'CSS',
  canvas2d: 'Canvas 2D',
};

/**
 * One still per slug: the card's poster, which is also what its preview starts
 * from, so mounting a preview only adds the effect to the picture that was
 * already there. The poster is what a card shows before its preview mounts,
 * after it is torn down, and if the effect cannot run at all.
 */
const POSTERS: Record<string, string> = {
  'film-burn-transition': '/media/shot-a.jpg',
  'film-grain-video': '/media/sample-poster.jpg',
  'film-burn-overlay': '/media/shot-b.jpg',
  'scribble-highlight': '/media/shot-c.jpg',
  'light-leak-transition': '/media/shot-b.jpg',
  'particulate-dissolve': '/media/shot-c.jpg',
  'subway-motion': '/media/shot-c.jpg',
  'comic-print': '/media/shot-a.jpg',
  bokeh: '/media/shot-b.jpg',
  'comic-impact': '/media/shot-b.jpg',
  'ripped-page': '/media/shot-a.jpg',
  'crumpled-paper': '/media/sample-poster.jpg',
  'wiggly-text': '/media/shot-c.jpg',
  'neon-sign': '/media/shot-b.jpg',
  'street-light': '/media/shot-c.jpg',
};
const FALLBACK_POSTER = '/media/shot-a.jpg';

function posterFor(slug: string): string {
  return POSTERS[slug] ?? FALLBACK_POSTER;
}

/** The one still where the dog faces the camera, so a cut to it is visible. */
const CUT_TO = '/media/shot-c.jpg';

/**
 * Scroll window shared by every scrubbed preview. `start` and `end` sum to 1,
 * which puts a card centred in the viewport at exactly progress 0.5 whatever
 * the card's height, so a resting gallery shows each transition mid-move and
 * scrolling the page scrubs all of them. That is the honest demonstration: the
 * reader's own scroll drives the effect, as it would on their page.
 *
 * None of the effects' own defaults work here. They are pinned scrubs written
 * for a host as tall as the viewport (`{ start: 0, end: 1 }` and friends);
 * on a 160px-tall card those collapse to a step at a single scroll position.
 */
/**
 * The window is deliberately far larger than the viewport, and that is what keeps
 * every scrubbed card legible.
 *
 * `scrollProgress` maps a card's top at `start` viewport-heights to 0 and its
 * bottom at `end` to 1, so a window that fits inside the viewport necessarily
 * drives a card through 0 and 1 while it is still on screen - and for a transition
 * those two ends are simply the two shots. A card resting near the top or bottom of
 * the viewport then showed a plain photograph and demonstrated nothing, which is
 * the complaint these previews exist to answer.
 *
 * Reaching well past the viewport in both directions compresses a card's whole
 * on-screen life onto the middle of the range instead. The symmetry
 * (`start - 1 === -end`) puts a centred card at exactly 0.5 whatever its height,
 * and on a 160px card in an 800px viewport the travel spans roughly 0.35..0.65:
 * still visibly scrubbed by the reader's scroll, but never parked on an end frame.
 */
const CARD_SCRUB = { start: 1.6, end: -0.6 };


/** What a preview composites over. */
type PreviewContent =
  /** Nothing: the effect brings its own media in through its own options. */
  | { content: 'none' }
  /** The card's own still, so the preview adds the effect to the poster's picture. */
  | { content: 'photo' }
  /** A line of real type on card paper — what the annotation effects annotate. */
  | { content: 'type'; text: string };

type PreviewRecipe = PreviewContent & {
  /**
   * Opaque card paper behind the preview. Only needed by an effect that reveals
   * what is behind it: with the poster showing through, a dissolve would read
   * as nothing having happened.
   */
  ground?: 'paper';
  /**
   * Stills the effect loads for itself beyond the card's own poster. Every one
   * is checked before the preview is allowed over the poster: handed an image
   * that does not load, an effect still builds its stage and paints an empty
   * black frame across the card, which is worse than the still it covered.
   */
  media?: readonly string[];
  /**
   * Mounts the effect. `target` is the type element for `content: 'type'` and
   * the preview box otherwise; `still` is the card's own poster image.
   */
  mount(target: HTMLElement, still: string): EffectHandle;
};

/**
 * Per-slug preview recipes. Each says three things: what the effect composites
 * over, which options make it read in a ~300x160 card instead of full-bleed, and
 * where its progress comes from. Every option set below is the effect's own
 * defaults apart from the ones commented — a card is a quarter of the width the
 * defaults were tuned against, so anything measured in absolute px, or in cells
 * across the frame, has to be restated.
 *
 * A slug with no entry here still gets a card: it keeps its static poster, which
 * is also what a card falls back to when a factory throws.
 */
const RECIPES: Record<string, PreviewRecipe> = {
  // `scale` is burn cells across the frame height, so the default of 3 puts one
  // blotch in a 160px card; 7 opens a handful of holes. `edge` is a fraction of
  // the frame, widened so the ignition rim is thicker than a hairline here.
  'film-burn-transition': {
    content: 'none',
    media: [CUT_TO],
    mount: (host, still) =>
      createFilmBurnTransition(host, {
        from: still,
        to: CUT_TO,
        scroll: CARD_SCRUB,
        scale: 7,
        edge: 0.1,
      }),
  },

  // The only preview with a video. `vignette` at its default darkens a third of
  // a card this small; `grainSize` is in CSS px, and 1.6px grain disappears at
  // card scale, so both are restated. `pauseOffscreen` stays on by default.
  'film-grain-video': {
    content: 'none',
    mount: (host, still) =>
      createFilmGrainVideo(host, {
        src: '/media/sample-1280.mp4',
        poster: still,
        vignette: 0.28,
        grainSize: 2.4,
      }),
  },

  // `src` is passed rather than relying on a host `<img>`, which this effect
  // throws without. `parallax` is in px: the default 60 slides a 160px frame a
  // third of the way out of shot, so it comes down to a slow 12px drift. The
  // treatment is pushed up from its defaults because a card only shows the burn
  // through a handful of small holes, and at 0.7 they read as smudges rather
  // than holes with embers in them.
  'film-burn-overlay': {
    content: 'none',
    mount: (host, still) =>
      createFilmBurnOverlay(host, {
        src: still,
        scroll: CARD_SCRUB,
        parallax: 12,
        holes: 5,
        intensity: 0.95,
        ember: 0.9,
        leak: 0.8,
      }),
  },

  // Scrubbed rather than played once: the 'inview' timeline draws the scribble
  // and then flutters it away, which would leave the card empty. At progress
  // 0.5 the drawing is complete and the flutter has not started.
  'scribble-highlight': {
    content: 'type',
    text: 'this bit',
    mount: (target) =>
      createScribbleHighlight(target, {
        trigger: 'scroll',
        scroll: CARD_SCRUB,
        padding: 7,
      }),
  },

  // The one preview held at a fixed frame rather than scrubbed, because neither of
  // this effect's styles survives a 300x160 card under a live scrub. The 'sweep'
  // style's bands are sized against the frame, so at card width they are wider than
  // the card and read as an undifferentiated warm haze - tried at three warmth and
  // softness settings, all mush. 'flash' does read, but it peaks on a blown white
  // frame, which is exactly where the compressed scrub window parks a centred card.
  // Holding the rising edge at 0.36 gives a strong amber bloom with both shots still
  // legible underneath, which is what a light leak looks like to a reader glancing at
  // a thumbnail. `softness` is a px blur radius: 80 is half this card.
  'light-leak-transition': {
    content: 'none',
    media: [CUT_TO],
    mount: (host, still) =>
      createLightLeakTransition(host, {
        from: still,
        to: CUT_TO,
        style: 'flash',
        scroll: false,
        progress: 0.36,
        softness: 18,
        warmth: 0.6,
        intensity: 0.95,
      }),
  },

  // Wants an opaque ground: the dissolve reveals what is behind it, and the
  // poster showing through would hide the whole effect. `flecks` is an absolute
  // particle count and `grain` a px cell size, both tuned for a large host —
  // 900 flecks in this box is a grey wash and 6px cells are coarse blocks.
  'particulate-dissolve': {
    content: 'none',
    ground: 'paper',
    mount: (host, still) =>
      createParticulateDissolve(host, {
        src: still,
        scroll: CARD_SCRUB,
        flecks: 220,
        grain: 2,
      }),
  },

  // Clock-driven, so the train keeps passing while the card is on screen. The
  // light smear is 1.5% of host width at the default speed — five px here, and
  // invisible; 1.5 takes it to the internal cap of 4.2%.
  'subway-motion': {
    content: 'photo',
    mount: (host) => createSubwayMotion(host, { speed: 1.5 }),
  },

  // Defaults hold: the halftone pitch is 4px, which is ~80 dots across a card
  // and still reads as newsprint. `levels` drops one step for a harder
  // posterisation, which is what survives being looked at small.
  'comic-print': {
    content: 'none',
    mount: (host, still) => createComicPrint(host, { src: still, levels: 4 }),
  },

  // Two things fight a bokeh field this small. `parallax` is in host heights, so
  // the default 0.6 flies the free discs out of a 160px frame before mid-scrub
  // and leaves only the anchored ones; and this still's highlights are already
  // defocused blobs, so a disc screened onto one adds almost nothing. `follow`
  // therefore drops well below its default to spread most of the field over the
  // dark half of the frame where a disc reads, `blades` gives it the polygonal
  // aperture cut that says lens rather than smudge, and `size`/`count` are set
  // for a dozen discs that each survive at 30px across.
  bokeh: {
    content: 'photo',
    mount: (host) =>
      createBokeh(host, {
        scroll: CARD_SCRUB,
        follow: 0.35,
        count: 12,
        size: 0.3,
        softness: 0.55,
        intensity: 1,
        rim: 0.4,
        blades: 6,
        parallax: 0.12,
      }),
  },

  // Scrubbed rather than played once, for the same reason as the scribble: the
  // 'inview' beat exits and leaves nothing. Progress 0.5 sits inside the hold
  // between the pop and the exit. `inkWidth` and `offset` are px on a burst
  // that is only as big as the word it is behind.
  'comic-impact': {
    content: 'type',
    text: 'POW!',
    mount: (target) =>
      createComicImpact(target, {
        trigger: 'scroll',
        scroll: CARD_SCRUB,
        inkWidth: 3,
        offset: 3,
        speedLines: 10,
      }),
  },

  // `separation` is in frame heights: at the default 0.95 both halves have left
  // the card by mid-scrub, so 0.6 keeps the torn edges and the gap in shot.
  // `edge` is the px width of the paper edge, trimmed to match the smaller box.
  'ripped-page': {
    content: 'none',
    media: [CUT_TO],
    mount: (host, still) =>
      createRippedPage(host, {
        from: still,
        to: CUT_TO,
        scroll: CARD_SCRUB,
        separation: 0.6,
        edge: 2,
      }),
  },

  // `scale` is px across a panel and panel count follows host area, so the
  // default 240 leaves under one panel in a 300x160 box — a flat sheet with no
  // creases. At 70 the crumple reads. Relief, sheen and paper tone are all
  // pushed up as well: the shading the defaults land on a full-bleed sheet is
  // too fine to survive being looked at this small.
  'crumpled-paper': {
    content: 'photo',
    mount: (host) =>
      createCrumpledPaper(host, {
        scale: 70,
        depth: 0.9,
        creases: 0.8,
        shine: 0.5,
        tone: 0.5,
        warp: 3,
      }),
  },

  // `amplitude` and `wavelength` are px keyed to the type being wiggled, not to
  // the host: past about a tenth of the font size stems tear, and a 90px
  // wavelength would bend the whole word as one. Sized for the 28px caption.
  'wiggly-text': {
    content: 'type',
    text: 'wiggly',
    mount: (target) => createWigglyText(target, { amplitude: 2.4, wavelength: 45 }),
  },

  // `spillRadius` is how far the pool of light reaches past the host in px. The
  // default 140 is wider than the whole card, so the pool would just be a wash;
  // 40 keeps it a pool. `glowRadius` follows the caption's smaller type.
  'neon-sign': {
    content: 'type',
    text: 'OPEN',
    mount: (target) =>
      createNeonSign(target, {
        glowRadius: 13,
        spillRadius: 40,
        flicker: 0.4,
      }),
  },

  // The only preview given a fixed progress instead of the scroll. The lamp is
  // pinned to the viewport, not to its host — `anchor` is a viewport fraction and
  // `drop` a fraction of viewport height — so with the defaults the lens sits
  // above the card and only the pool sweeps through. `anchor: 0.5` with
  // `progress: 0.5` cancels the viewport terms exactly and centres the lens in
  // the card at any viewport height; `drop` and `spread` come down from
  // viewport-scale to card-scale so the whole rig — mast, arm, head, pool — is in
  // frame. Scrubbing it here would walk the lamp out of a 160px card within a
  // sixth of the scroll range and read as plain night either side.
  'street-light': {
    content: 'photo',
    mount: (host) =>
      createStreetLight(host, {
        scroll: false,
        progress: 0.5,
        anchor: 0.5,
        drop: 0.045,
        spread: 0.05,
        stretch: 1.3,
      }),
  },
};

/**
 * Live previews at once. Six covers a full 1280x800 screen of cards, and keeps
 * the page well clear of the browser's ~16 live WebGL context ceiling — six of
 * these effects take a context each when WebGL2 is available.
 */
const PREVIEW_CAP = 6;
/** Mount once a card is this close to the viewport, so it is ready on arrival. */
const MOUNT_MARGIN_PX = 160;
/** Tear down once it is this far clear, releasing its context and filters. */
const RETAIN_MARGIN_PX = 600;
/**
 * How long the page has to hold still before a preview is built. Building one
 * compiles a shader or rasterises a fresh filter subtree, which measured at up
 * to 42ms in Gecko — five frames — so it cannot happen inside a scroll. While
 * the reader is moving, the cards they pass keep their posters.
 */
const SCROLL_QUIET_MS = 100;

interface PreviewSlot {
  readonly effect: EffectMeta;
  readonly recipe: PreviewRecipe;
  readonly art: HTMLElement;
  near: boolean;
  retained: boolean;
  box: HTMLElement | null;
  handle: EffectHandle | null;
  /** A factory that threw is not retried; the card keeps its poster. */
  failed: boolean;
}

const slots: PreviewSlot[] = [];
let reconcileQueued = false;
let mountQueued = false;
let lastScrollY = window.scrollY;
let scrollMovedAt = 0;

/** True once the page has held one position for `SCROLL_QUIET_MS`. */
function scrollSettled(): boolean {
  const y = window.scrollY;
  const now = performance.now();
  if (y !== lastScrollY) {
    lastScrollY = y;
    scrollMovedAt = now;
  }
  return now - scrollMovedAt >= SCROLL_QUIET_MS;
}

/** Runs a task in the browser's spare time, with a deadline so it cannot starve. */
function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(task, { timeout: 400 });
  else setTimeout(task, 32);
}

function buildPreviewBox(slot: PreviewSlot): HTMLElement {
  const box = document.createElement('div');
  box.className = 'gallery-card-preview';
  box.setAttribute('aria-hidden', 'true');
  if (slot.recipe.ground === 'paper') box.classList.add('gallery-card-preview--paper');

  if (slot.recipe.content === 'photo') {
    const photo = document.createElement('img');
    photo.className = 'gallery-preview-photo';
    photo.src = posterFor(slot.effect.slug);
    photo.alt = '';
    photo.decoding = 'async';
    box.append(photo);
  } else if (slot.recipe.content === 'type') {
    box.classList.add('gallery-card-preview--type');
    const type = document.createElement('span');
    type.className = 'gallery-preview-type';
    type.textContent = slot.recipe.text;
    box.append(type);
  }

  return box;
}

/** Several effects read the host's size at construction, so attach, then mount. */
function mountPreview(slot: PreviewSlot): void {
  const box = buildPreviewBox(slot);
  const target = box.querySelector<HTMLElement>('.gallery-preview-type') ?? box;
  slot.art.append(box);

  try {
    slot.handle = slot.recipe.mount(target, posterFor(slot.effect.slug));
    slot.box = box;
  } catch (error) {
    box.remove();
    slot.failed = true;
    console.warn(`gallery: no live preview for ${slot.effect.slug}`, error);
  }
}

function unmountPreview(slot: PreviewSlot): void {
  slot.handle?.destroy();
  slot.handle = null;
  slot.box?.remove();
  slot.box = null;
}

/** One entry per URL any recipe draws on, shared by every card that names it. */
const stillState = new Map<string, 'pending' | 'ok' | 'missing'>();

/** `null` while the check is still in flight. */
function stillLoads(url: string): boolean | null {
  const state = stillState.get(url);
  if (state === 'ok') return true;
  if (state === 'missing') return false;
  if (state === undefined) {
    stillState.set(url, 'pending');
    // A card's own poster has usually fetched this already, so the probe is a
    // cache hit; a `<video>`'s own poster option covers the one preview that
    // loads something other than a still.
    const probe = new Image();
    const settle = (result: 'ok' | 'missing') => () => {
      stillState.set(url, result);
      requestReconcile();
    };
    probe.addEventListener('load', settle('ok'), { once: true });
    probe.addEventListener('error', settle('missing'), { once: true });
    probe.src = url;
  }
  return null;
}

const NO_EXTRA_MEDIA: readonly string[] = [];

/** Whether every still this preview will draw is known to load. */
function stillsReady(slot: PreviewSlot): boolean | null {
  let pending = false;
  for (const url of [posterFor(slot.effect.slug), ...(slot.recipe.media ?? NO_EXTRA_MEDIA)]) {
    const loads = stillLoads(url);
    if (loads === false) return false;
    if (loads === null) pending = true;
  }
  return pending ? null : true;
}

/**
 * Closest to the middle of the viewport first. Ranking by distance rather than
 * document order is what makes the cap behave while scrolling: a card that has
 * scrolled away loses its slot to one arriving, instead of holding it until it
 * leaves the retain zone.
 */
function byDistanceFromViewport(): PreviewSlot[] {
  const middle = window.innerHeight / 2;
  return slots
    .filter((slot) => slot.retained && !slot.failed)
    .map((slot) => {
      const rect = slot.art.getBoundingClientRect();
      return { slot, distance: Math.abs((rect.top + rect.bottom) / 2 - middle) };
    })
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.slot);
}

/** The closest card that is wanted and has no preview yet. */
function nextToMount(wanted: Iterable<PreviewSlot>): PreviewSlot | null {
  for (const slot of wanted) {
    if (slot.handle === null) return slot;
  }
  return null;
}

function reconcile(): void {
  const wanted = new Set<PreviewSlot>();
  for (const slot of byDistanceFromViewport()) {
    if (wanted.size >= PREVIEW_CAP) break;
    if (slot.near || slot.handle !== null) wanted.add(slot);
  }

  // Teardown is not deferred: it is a `destroy()` call and a detach, and a
  // preview that has scrolled away should give its WebGL context back now.
  for (const slot of slots) {
    if (slot.handle !== null && !wanted.has(slot)) unmountPreview(slot);
  }

  if (mountQueued) return;
  const slot = nextToMount(wanted);
  if (slot === null) return;

  // Still moving: keep watching rather than building anything. Nothing else
  // wakes this up once the reader stops, so the pass reschedules itself.
  if (!scrollSettled()) {
    requestReconcile();
    return;
  }

  // A missing still is a deployment fault, not a bug to crash on: the card holds
  // the poster it already has, and this slot is not tried again.
  const stills = stillsReady(slot);
  if (stills === false) {
    slot.failed = true;
    console.warn(`gallery: no live preview for ${slot.effect.slug}, its media did not load`);
    requestReconcile();
    return;
  }
  // A check still in flight reschedules this pass when it lands.
  if (stills === null) return;

  mountQueued = true;
  whenIdle(() => {
    mountQueued = false;
    // One preview per idle slice, re-ranked after each: by the time this runs
    // the reader may be somewhere else entirely.
    if (scrollSettled() && slot.retained && !slot.failed && slot.handle === null) mountPreview(slot);
    requestReconcile();
  });
}

/** Coalesces both observers' callbacks into one pass on the next frame. */
function requestReconcile(): void {
  if (reconcileQueued) return;
  reconcileQueued = true;
  requestAnimationFrame(() => {
    reconcileQueued = false;
    reconcile();
  });
}

/**
 * Two observers: the inner margin says a card is close enough to be worth a
 * preview, the outer one says it is far enough to give its resources back.
 */
function startPreviews(): void {
  const byArt = new Map(slots.map((slot) => [slot.art, slot]));
  const observe = (marginPx: number, apply: (slot: PreviewSlot, visible: boolean) => void): void => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slot = byArt.get(entry.target as HTMLElement);
          if (slot) apply(slot, entry.isIntersecting);
        }
        requestReconcile();
      },
      { rootMargin: `${marginPx}px 0px` },
    );
    for (const slot of slots) observer.observe(slot.art);
  };

  observe(MOUNT_MARGIN_PX, (slot, visible) => {
    slot.near = visible;
  });
  observe(RETAIN_MARGIN_PX, (slot, visible) => {
    slot.retained = visible;
  });
}

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Missing mount point: ${selector}`);
  }
  return element;
}

function techChip(tech: EffectTech): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'gallery-chip';
  chip.textContent = TECH_LABELS[tech];
  return chip;
}

function buildCardArt(effect: EffectMeta, eager: boolean): HTMLDivElement {
  const art = document.createElement('div');
  art.className = 'gallery-card-art';
  art.setAttribute('aria-hidden', 'true');

  const poster = document.createElement('img');
  poster.className = 'gallery-card-poster';
  poster.src = posterFor(effect.slug);
  poster.alt = '';
  poster.loading = eager ? 'eager' : 'lazy';
  poster.decoding = eager ? 'sync' : 'async';
  art.append(poster);

  const recipe = RECIPES[effect.slug];
  if (recipe) {
    slots.push({
      effect,
      recipe,
      art,
      near: false,
      retained: false,
      box: null,
      handle: null,
      failed: false,
    });
  }

  return art;
}

function buildCard(effect: EffectMeta, eager: boolean): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'gallery-card';
  card.href = effect.demo;
  card.append(buildCardArt(effect, eager));

  const body = document.createElement('div');
  body.className = 'gallery-card-body';

  const title = document.createElement('h3');
  title.textContent = effect.title;
  body.append(title);

  const blurb = document.createElement('p');
  blurb.className = 'gallery-card-blurb';
  blurb.textContent = effect.blurb;
  body.append(blurb);

  const meta = document.createElement('div');
  meta.className = 'gallery-card-meta';

  const chips = document.createElement('div');
  chips.className = 'gallery-card-chips';
  for (const tech of effect.tech) {
    chips.append(techChip(tech));
  }
  meta.append(chips);

  if (effect.scrollDriven) {
    const scrollBadge = document.createElement('span');
    scrollBadge.className = 'gallery-card-scroll';
    scrollBadge.textContent = 'Scroll-scrubbed';
    meta.append(scrollBadge);
  }
  body.append(meta);

  const tags = document.createElement('p');
  tags.className = 'gallery-card-tags';
  tags.textContent = effect.tags.join(' · ');
  body.append(tags);

  card.append(body);
  return card;
}

function buildGroup(category: EffectCategory, effects: EffectMeta[], firstOverall: boolean): HTMLElement {
  const group = document.createElement('section');
  group.className = 'gallery-group';
  group.setAttribute('aria-labelledby', `gallery-group-${category}`);

  const head = document.createElement('div');
  head.className = 'gallery-group-head';

  const heading = document.createElement('h2');
  heading.id = `gallery-group-${category}`;
  heading.textContent = CATEGORY_LABELS[category];
  head.append(heading);

  const count = document.createElement('span');
  count.className = 'gallery-group-count';
  count.textContent = String(effects.length);
  head.append(count);

  group.append(head);

  const grid = document.createElement('div');
  grid.className = 'gallery-grid';
  effects.forEach((effect, index) => {
    grid.append(buildCard(effect, firstOverall && index === 0));
  });
  group.append(grid);

  return group;
}

function renderCatalogue(): void {
  const mount = requireElement('#catalogue');
  const countMount = requireElement('#effect-count');

  countMount.textContent = `${EFFECTS.length} effects`;

  const container = document.createElement('div');
  container.className = 'gallery-catalogue';

  let seenFirst = false;
  for (const category of CATEGORY_ORDER) {
    const effects = EFFECTS.filter((effect) => effect.category === category);
    if (effects.length === 0) {
      continue;
    }
    container.append(buildGroup(category, effects, !seenFirst));
    seenFirst = true;
  }

  mount.append(container);
  startPreviews();
}

renderCatalogue();

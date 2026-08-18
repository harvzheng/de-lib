/**
 * Renders the gallery landing page from the effect manifest.
 * Demo chrome only — never imported by an effect.
 */

import './demo.css';
import './gallery.css';

import type { EffectCategory, EffectMeta, EffectTech } from '../effects/manifest';
import { EFFECTS } from '../effects/manifest';

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

type ArtTreatment = 'burn' | 'filmstock' | 'scribble';

const CATEGORY_TREATMENT: Record<EffectCategory, ArtTreatment> = {
  transition: 'burn',
  overlay: 'burn',
  background: 'filmstock',
  annotation: 'scribble',
};

/**
 * One still per slug. Four stills, nine effects — exact uniqueness is
 * impossible, so pairings are chosen so no two adjacent cards in rendered
 * order (grouped by category, in manifest order) repeat both the same
 * still and the same category treatment.
 */
const CARD_ART: Record<string, string> = {
  'film-burn-transition': '/media/shot-a.jpg',
  'film-grain-video': '/media/sample-poster.jpg',
  'film-burn-overlay': '/media/shot-b.jpg',
  'scribble-highlight': '/media/shot-c.jpg',
  'light-leak-transition': '/media/shot-b.jpg',
  'particulate-dissolve': '/media/shot-c.jpg',
  'subway-motion': '/media/shot-c.jpg',
  'comic-print': '/media/shot-a.jpg',
  'comic-impact': '/media/shot-b.jpg',
};
const FALLBACK_ART = '/media/shot-a.jpg';

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

function buildScribbleOverlay(): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 200 106');
  svg.setAttribute('class', 'gallery-scribble');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(svgNs, 'path');
  path.setAttribute(
    'd',
    'M14,70 Q40,18 76,46 T140,32 Q158,26 182,52 M22,84 Q70,96 118,80 T188,74',
  );
  path.setAttribute('class', 'gallery-scribble-path');
  svg.append(path);

  return svg;
}

const BURN_BLEND_MODES = ['screen', 'plus-lighter', 'hard-light'] as const;
const FILMSTOCK_BLEND_MODES = ['overlay', 'soft-light'] as const;

/** Deterministic string hash (FNV-1a), so the same slug always yields the same variant. */
function hashSlug(slug: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < slug.length; i += 1) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Several slugs now share a category treatment (burn: transitions and
 * overlays; scribble: annotations). This derives a per-slug hue, blend
 * mode, and gradient placement from the slug itself — not a hand-maintained
 * map — so cards sharing a treatment read differently, and any future slug
 * gets a variant for free.
 */
function applyArtVariant(art: HTMLDivElement, effect: EffectMeta, treatment: ArtTreatment): void {
  const hash = hashSlug(effect.slug);
  const hue = (hash % 13) * 6 - 36;
  art.style.setProperty('--gallery-art-hue', `${hue}deg`);

  if (treatment === 'burn') {
    const x = 8 + (hash % 5) * 6;
    const y = 96 + ((hash >>> 4) % 5) * 6;
    art.style.setProperty('--gallery-art-x', `${x}%`);
    art.style.setProperty('--gallery-art-y', `${y}%`);
    art.style.setProperty('--gallery-art-blend', BURN_BLEND_MODES[hash % BURN_BLEND_MODES.length]);
  } else if (treatment === 'filmstock') {
    const angle = (hash % 6) * 60;
    art.style.setProperty('--gallery-art-angle', `${angle}deg`);
    art.style.setProperty('--gallery-art-blend', FILMSTOCK_BLEND_MODES[hash % FILMSTOCK_BLEND_MODES.length]);
  }
}

function buildCardArt(effect: EffectMeta): HTMLDivElement {
  const treatment = CATEGORY_TREATMENT[effect.category];
  const art = document.createElement('div');
  art.className = `gallery-card-art gallery-card-art--${treatment}`;
  art.setAttribute('aria-hidden', 'true');
  applyArtVariant(art, effect, treatment);

  const img = document.createElement('img');
  img.src = CARD_ART[effect.slug] ?? FALLBACK_ART;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  art.append(img);

  if (treatment === 'scribble') {
    art.append(buildScribbleOverlay());
  }

  return art;
}

function buildCard(effect: EffectMeta, eager: boolean): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'gallery-card';
  card.href = effect.demo;

  const art = buildCardArt(effect);
  if (eager) {
    const img = art.querySelector('img');
    if (img) {
      img.loading = 'eager';
      img.decoding = 'sync';
    }
  }
  card.append(art);

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
}

renderCatalogue();

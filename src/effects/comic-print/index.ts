import { createLayer } from '../../core/dom';
import { clamp01 } from '../../core/math';
import { createFilter } from '../../core/svg';
import type { Effect } from '../../core/types';

export type ComicPalette = 'newsprint' | 'sunday' | 'mono' | 'noir';

export interface ComicPrintOptions {
  /** Optional image or video to treat. Omit to treat the host's existing content. */
  src?: string | HTMLImageElement | HTMLVideoElement;
  /** Default 'newsprint'. */
  palette?: ComicPalette;
  /** Halftone dot pitch in px. Default 4. */
  dotSize?: number;
  /** Halftone screen strength, 0..1. Default 0.55. */
  halftone?: number;
  /** Screen rotation in degrees. Default 15. */
  screenAngle?: number;
  /** Posterisation steps per channel. Default 5. */
  levels?: number;
  /** Ink misregistration offset in px. Default 1.5. */
  misregistration?: number;
  /** Paper grain strength, 0..1. Default 0.4. */
  grain?: number;
  /** Paper tint. Default '#f4ecd8'. */
  paper?: string;
  /** Ink edge roughness, 0..1. Default 0.3. */
  roughness?: number;
  /** Contrast push before screening, 0..2. Default 1.15. */
  contrast?: number;
}

export interface ComicPrintHandle extends Effect<ComicPrintOptions> {}

type Resolved = Required<Omit<ComicPrintOptions, 'src'>> & Pick<ComicPrintOptions, 'src'>;

const DEFAULTS: Resolved = {
  src: undefined,
  palette: 'newsprint',
  dotSize: 4,
  halftone: 0.55,
  screenAngle: 15,
  levels: 5,
  misregistration: 1.5,
  grain: 0.4,
  paper: '#f4ecd8',
  roughness: 0.3,
  contrast: 1.15,
};

const PALETTE_MATRICES: Record<ComicPalette, string> = {
  newsprint: `1.04 0.04 0.01 0 -0.035
              0.04 0.94 0.02 0  0.005
              0.02 0.08 0.79 0  0.045
              0    0    0    1  0`,
  sunday: `1.15 -0.07 -0.02 0 0
           -0.03 1.10 -0.01 0 0.01
           -0.02 -0.05 1.13 0 0.015
            0     0     0    1 0`,
  mono: `0.31 0.58 0.11 0 0.02
         0.31 0.58 0.11 0 0.02
         0.31 0.58 0.11 0 0.02
         0    0    0    1 0`,
  noir: `0.38 0.72 0.14 0 -0.12
         0.38 0.72 0.14 0 -0.12
         0.38 0.72 0.14 0 -0.12
         0    0    0    1  0`,
};

const PRINT_FILTER = `
  <filter filterUnits="objectBoundingBox" x="-12%" y="-12%" width="124%" height="124%"
          color-interpolation-filters="sRGB">
    <feComponentTransfer in="SourceGraphic" result="contrasted">
      <feFuncR data-p="contrast-r" type="linear" slope="1.15" intercept="-0.075" />
      <feFuncG data-p="contrast-g" type="linear" slope="1.15" intercept="-0.075" />
      <feFuncB data-p="contrast-b" type="linear" slope="1.15" intercept="-0.075" />
    </feComponentTransfer>
    <feComponentTransfer in="contrasted" result="posterised">
      <feFuncR data-p="poster-r" type="discrete" tableValues="0 0.25 0.5 0.75 1" />
      <feFuncG data-p="poster-g" type="discrete" tableValues="0 0.25 0.5 0.75 1" />
      <feFuncB data-p="poster-b" type="discrete" tableValues="0 0.25 0.5 0.75 1" />
    </feComponentTransfer>
    <feColorMatrix data-p="palette" in="posterised" type="matrix" result="print"
      values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" />
    <feColorMatrix in="print" type="matrix" result="red"
      values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />
    <feColorMatrix in="print" type="matrix" result="green"
      values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" />
    <feColorMatrix in="print" type="matrix" result="blue"
      values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" />
    <feOffset data-p="offset-r" in="red" dx="1.5" dy="0" result="red-offset" />
    <feOffset data-p="offset-g" in="green" dx="0" dy="0.6" result="green-offset" />
    <feOffset data-p="offset-b" in="blue" dx="-1.5" dy="-0.5" result="blue-offset" />
    <feBlend in="red-offset" in2="green-offset" mode="screen" result="rg" />
    <feBlend in="rg" in2="blue-offset" mode="screen" result="registered" />
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="19"
                  stitchTiles="stitch" result="rough" />
    <feDisplacementMap data-p="roughness" in="registered" in2="rough" scale="1.8"
                       xChannelSelector="R" yChannelSelector="G" />
  </filter>
`;

function resolve(base: Resolved, patch: ComicPrintOptions): Resolved {
  return {
    src: Object.prototype.hasOwnProperty.call(patch, 'src') ? patch.src : base.src,
    palette: patch.palette ?? base.palette,
    dotSize: patch.dotSize ?? base.dotSize,
    halftone: patch.halftone ?? base.halftone,
    screenAngle: patch.screenAngle ?? base.screenAngle,
    levels: patch.levels ?? base.levels,
    misregistration: patch.misregistration ?? base.misregistration,
    grain: patch.grain ?? base.grain,
    paper: patch.paper ?? base.paper,
    roughness: patch.roughness ?? base.roughness,
    contrast: patch.contrast ?? base.contrast,
  };
}

function isVideoSource(src: string): boolean {
  return /\.(?:mp4|webm|ogv|ogg)(?:[?#].*)?$/i.test(src);
}

export function createComicPrint(
  host: HTMLElement,
  options: ComicPrintOptions = {},
): ComicPrintHandle {
  let config = resolve(DEFAULTS, options);
  const hadHostClass = host.classList.contains('comic-print-host');
  const originalBackground = host.style.backgroundColor;
  const originalPosition = host.style.position;
  const originalNodes = Array.from(host.childNodes);
  const originalStore = document.createDocumentFragment();
  originalStore.append(...originalNodes);

  host.classList.add('comic-print-host');
  const marker = document.createComment('comic-print');
  const content = document.createElement('div');
  content.className = 'comic-print-content';
  host.append(marker, content);
  const halftone = createLayer(host, 'div', 'comic-print-halftone');
  halftone.setAttribute('aria-hidden', 'true');
  halftone.style.inset = '-55%';
  halftone.style.width = 'auto';
  halftone.style.height = 'auto';
  const grain = createLayer(host, 'div', 'comic-print-grain');
  grain.setAttribute('aria-hidden', 'true');
  const filter = createFilter(PRINT_FILTER, 'comic-print');
  content.style.filter = filter.css;

  let mountedSource: ComicPrintOptions['src'] = undefined;
  let sourceElement: HTMLImageElement | HTMLVideoElement | null = null;
  let sourceOwned = false;
  let sourceHadClass = false;
  let sourceParent: Node | null = null;
  let sourceNextSibling: Node | null = null;
  let destroyed = false;

  function releaseSource(): void {
    if (sourceElement === null) return;
    sourceElement.classList.toggle('comic-print-media', sourceHadClass);
    if (!sourceOwned && sourceParent !== null) {
      if (sourceNextSibling !== null && sourceNextSibling.parentNode === sourceParent) {
        sourceParent.insertBefore(sourceElement, sourceNextSibling);
      } else {
        sourceParent.appendChild(sourceElement);
      }
    } else {
      sourceElement.remove();
    }
    sourceElement = null;
    sourceOwned = false;
    sourceParent = null;
    sourceNextSibling = null;
  }

  function syncSource(): void {
    if (config.src === mountedSource && content.childNodes.length > 0) return;
    releaseSource();
    originalStore.append(...originalNodes);
    content.replaceChildren();
    mountedSource = config.src;

    if (config.src === undefined) {
      content.append(...originalNodes);
      return;
    }

    if (typeof config.src === 'string') {
      if (isVideoSource(config.src)) {
        const video = document.createElement('video');
        video.src = config.src;
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        sourceElement = video;
      } else {
        const image = document.createElement('img');
        image.src = config.src;
        image.alt = '';
        sourceElement = image;
      }
      sourceOwned = true;
      sourceHadClass = false;
    } else {
      sourceElement = config.src;
      sourceOwned = false;
      sourceHadClass = sourceElement.classList.contains('comic-print-media');
      sourceParent = sourceElement.parentNode;
      sourceNextSibling = sourceElement.nextSibling;
    }
    sourceElement.classList.add('comic-print-media');
    content.append(sourceElement);
  }

  // Writing an attribute on a filter primitive invalidates the raster of every
  // element the filter is applied to, so each group below is only written when the
  // one option that feeds it has actually moved. Without this, dragging a slider
  // that only touches a CSS custom property still rebuilds the whole print filter.
  let rendered: Resolved | null = null;

  function render(): void {
    const previous = rendered;
    rendered = config;

    if (previous === null || config.levels !== previous.levels) {
      const levels = Math.max(2, Math.min(16, Math.round(config.levels)));
      const table: string[] = [];
      for (let index = 0; index < levels; index += 1) {
        table.push((index / (levels - 1)).toFixed(3));
      }
      const tableValues = table.join(' ');
      for (const channel of ['r', 'g', 'b']) filter.set(`poster-${channel}`, { tableValues });
    }

    if (previous === null || config.contrast !== previous.contrast) {
      const contrast = Math.max(0, Math.min(2, config.contrast));
      const intercept = (0.5 - contrast * 0.5).toFixed(4);
      for (const channel of ['r', 'g', 'b']) {
        filter.set(`contrast-${channel}`, { slope: contrast, intercept });
      }
    }

    if (previous === null || config.palette !== previous.palette) {
      filter.set('palette', { values: PALETTE_MATRICES[config.palette] });
    }

    if (previous === null || config.misregistration !== previous.misregistration) {
      const offset = Math.max(0, config.misregistration);
      filter.set('offset-r', { dx: offset, dy: 0 });
      filter.set('offset-g', { dx: 0, dy: offset * 0.42 });
      filter.set('offset-b', { dx: -offset, dy: -offset * 0.34 });
    }

    if (previous === null || config.roughness !== previous.roughness) {
      filter.set('roughness', { scale: clamp01(config.roughness) * 6 });
    }

    if (previous === null || config.paper !== previous.paper) {
      host.style.backgroundColor = config.paper;
    }
    if (previous === null || config.dotSize !== previous.dotSize) {
      host.style.setProperty('--comic-print-dot-size', `${Math.max(1, config.dotSize)}px`);
    }
    if (previous === null || config.halftone !== previous.halftone) {
      host.style.setProperty('--comic-print-halftone', String(clamp01(config.halftone)));
    }
    if (previous === null || config.screenAngle !== previous.screenAngle) {
      host.style.setProperty('--comic-print-angle', `${config.screenAngle}deg`);
    }
    if (previous === null || config.grain !== previous.grain) {
      host.style.setProperty('--comic-print-grain', String(clamp01(config.grain)));
    }
  }

  syncSource();
  render();

  return {
    setOptions(patch: Partial<ComicPrintOptions>): void {
      if (destroyed) return;
      config = resolve(config, patch);
      syncSource();
      render();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      releaseSource();
      originalStore.append(...originalNodes);
      content.remove();
      host.insertBefore(originalStore, marker);
      marker.remove();
      halftone.remove();
      grain.remove();
      filter.destroy();
      host.style.backgroundColor = originalBackground;
      host.style.position = originalPosition;
      host.style.removeProperty('--comic-print-dot-size');
      host.style.removeProperty('--comic-print-halftone');
      host.style.removeProperty('--comic-print-angle');
      host.style.removeProperty('--comic-print-grain');
      if (!hadHostClass) host.classList.remove('comic-print-host');
    },
  };
}

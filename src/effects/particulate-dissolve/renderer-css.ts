import { createLayer, onVisible } from '../../core/dom';
import { clamp01 } from '../../core/math';
import { onReducedMotionChange, prefersReducedMotion } from '../../core/motion';
import { createFilter } from '../../core/svg';
import { createParticles, particleState } from './particles';
import type {
  DissolveConfig,
  DissolveDirection,
  DissolveMedia,
  DissolveRendererInstance,
} from './index';
import type { DissolveParticle } from './particles';

const FILTER_SOFTNESS = 0.018;

const FILTER_MARKUP = `
<filter color-interpolation-filters="sRGB" x="-8%" y="-8%" width="116%" height="116%">
  <feTurbulence data-p="noise" type="fractalNoise" baseFrequency="0.025" numOctaves="2"
    seed="1" stitchTiles="noStitch" result="noise"/>
  <feColorMatrix in="noise" type="luminanceToAlpha" result="noiseAlpha"/>
  <feImage data-p="directionImage" preserveAspectRatio="none" result="directionField"/>
  <feColorMatrix in="directionField" type="luminanceToAlpha" result="directionAlpha"/>
  <feComposite data-p="fieldBlend" in="noiseAlpha" in2="directionAlpha" operator="arithmetic"
    k1="0" k2="0.78" k3="0.28" k4="0" result="field"/>

  <feComponentTransfer in="field" result="bodyMask">
    <feFuncA data-p="bodyThreshold" type="linear" slope="56" intercept="4"/>
  </feComponentTransfer>
  <feComponentTransfer in="field" result="edgeOuterMask">
    <feFuncA data-p="edgeThreshold" type="linear" slope="56" intercept="4"/>
  </feComponentTransfer>
  <feComposite in="bodyMask" in2="edgeOuterMask" operator="out" result="edgeBand"/>

  <feComposite in="SourceGraphic" in2="bodyMask" operator="in" result="body"/>
  <feDisplacementMap data-p="displace" in="SourceGraphic" in2="noise" scale="0"
    xChannelSelector="R" yChannelSelector="G" result="edgeDisplaced"/>
  <feComposite in="edgeDisplaced" in2="edgeBand" operator="in" result="edgeSource"/>
  <feOffset data-p="edgeOffset" in="edgeSource" dx="0" dy="0" result="edgeMoved"/>
  <feComponentTransfer in="edgeMoved" result="edgeNatural">
    <feFuncA data-p="naturalOpacity" type="linear" slope="1" intercept="0"/>
  </feComponentTransfer>
  <feFlood data-p="ashFlood" flood-color="#777777" flood-opacity="0" result="ashColour"/>
  <feComposite in="ashColour" in2="edgeBand" operator="in" result="ashEdge"/>
  <feOffset data-p="ashOffset" in="ashEdge" dx="0" dy="0" result="ashMoved"/>

  <feMerge>
    <feMergeNode in="body"/>
    <feMergeNode in="edgeNatural"/>
    <feMergeNode in="ashMoved"/>
  </feMerge>
</filter>`;

function displayElement(media: DissolveMedia): DissolveMedia {
  if (!media.isConnected) return media;
  if (media instanceof HTMLVideoElement) {
    const video = document.createElement('video');
    video.crossOrigin = media.crossOrigin;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = media.loop;
    video.src = media.currentSrc || media.src;
    return video;
  }
  const image = new Image();
  image.crossOrigin = media.crossOrigin;
  image.src = media.currentSrc || media.src;
  return image;
}

function drawMediaCover(
  context: CanvasRenderingContext2D,
  media: DissolveMedia,
  width: number,
  height: number,
): boolean {
  const sourceWidth =
    media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const sourceHeight =
    media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (sourceWidth === 0 || sourceHeight === 0) return false;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(media, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  return true;
}

function directionVector(direction: DissolveDirection): readonly [number, number] {
  switch (direction) {
    case 'left':
      return [-1, 0];
    case 'right':
      return [1, 0];
    case 'up':
      return [0, -1];
    case 'down':
      return [0, 1];
    case 'random':
      return [0, 0];
  }
}

const directionFields: Partial<Record<DissolveDirection, string>> = {};

function directionField(direction: DissolveDirection): string {
  const cached = directionFields[direction];
  if (cached !== undefined) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d');
  if (context === null) return '';

  if (direction === 'random') {
    context.fillStyle = '#808080';
  } else {
    const coordinates: Record<
      Exclude<DissolveDirection, 'random'>,
      readonly [number, number, number, number]
    > = {
      left: [0, 0, 16, 0],
      right: [16, 0, 0, 0],
      up: [0, 0, 0, 16],
      down: [0, 16, 0, 0],
    };
    const gradient = context.createLinearGradient(...coordinates[direction]);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(1, '#ffffff');
    context.fillStyle = gradient;
  }
  context.fillRect(0, 0, 16, 16);
  const field = canvas.toDataURL('image/png');
  directionFields[direction] = field;
  return field;
}

export function createCssDissolveRenderer(
  host: HTMLElement,
  initial: DissolveConfig,
): DissolveRendererInstance {
  const liveNodes = initial.mediaRequested ? [] : Array.from(host.childNodes);
  const body = document.createElement('div');
  body.className = initial.mediaRequested
    ? 'particulate-dissolve-body particulate-dissolve-media-body'
    : 'particulate-dissolve-body particulate-dissolve-live-body';
  if (!initial.mediaRequested) {
    host.insertBefore(body, host.firstChild);
    for (const node of liveNodes) body.append(node);
  }

  const stack = createLayer(host, 'div', 'particulate-dissolve-stack');
  const canvas = document.createElement('canvas');
  canvas.className = 'particulate-dissolve-flecks';
  if (initial.mediaRequested) stack.append(body);
  stack.append(canvas);

  const filter = createFilter(FILTER_MARKUP, 'particulate-dissolve');
  body.style.filter = filter.css;
  const context = canvas.getContext('2d');
  const sourceCanvas = document.createElement('canvas');
  const sourceContext = sourceCanvas.getContext('2d');

  let config = initial;
  let sourceMedia: DissolveMedia | null = null;
  let shownMedia: DissolveMedia | null = null;
  let sampledMedia: DissolveMedia | null = null;
  let sampledWidth = 0;
  let sampledHeight = 0;
  let sourceSampleReady = false;
  let fleckColour = '#777777';
  let progress = 0;
  let width = 0;
  let height = 0;
  let particles: DissolveParticle[] = [];
  let flecksDrawn = false;
  let reduced = prefersReducedMotion();
  let visible = true;
  let destroyed = false;

  function setThreshold(name: string, value: number): void {
    filter.set(name, {
      slope: 1 / FILTER_SOFTNESS,
      intercept: 0.5 - value / FILTER_SOFTNESS,
    });
  }

  function mountMedia(): void {
    if (!config.mediaRequested || config.media === sourceMedia) return;
    if (shownMedia instanceof HTMLVideoElement) shownMedia.pause();
    sourceMedia = config.media;
    sampledMedia = null;
    sourceSampleReady = false;
    body.replaceChildren();
    shownMedia = config.media === null ? null : displayElement(config.media);
    if (shownMedia !== null) body.append(shownMedia);
  }

  function syncMediaActivity(): void {
    if (!(shownMedia instanceof HTMLVideoElement)) return;
    if (visible && !reduced && !destroyed) {
      void shownMedia.play().catch((error: unknown) => {
        console.warn('particulate-dissolve: video playback was refused.', error);
      });
    } else {
      shownMedia.pause();
    }
  }

  function rebuildParticles(): void {
    particles = createParticles({
      width,
      height,
      grain: Math.max(1, config.grain),
      count: config.flecks,
      seed: config.seed,
      direction: config.direction,
    });
  }

  function updateDirectionField(): void {
    const directional = config.direction !== 'random';
    filter.set('fieldBlend', { k2: directional ? 0.78 : 1, k3: directional ? 0.28 : 0 });
    filter.set('directionImage', { href: directionField(config.direction) });
  }

  function paintFilter(): void {
    const p = clamp01(progress);
    body.style.filter = p === 0 ? 'none' : filter.css;
    body.style.visibility = p === 1 ? 'hidden' : '';
    // Every primitive write invalidates the raster of the filtered body, and at an
    // endpoint the filter is either off or the body is hidden, so nothing the
    // primitives describe can be seen. `onScrollProgress` keeps reporting a clamped
    // 0 or 1 for the whole rest of the page, so this is the common idle case.
    if (p === 0 || p === 1) return;
    const lead = clamp01(config.edge) * 0.12 * Math.sin(Math.PI * p);
    const threshold = -0.08 + p * 1.16 + lead;
    const horizontal = config.direction === 'left' || config.direction === 'right';
    const fieldExtent = horizontal ? width : height;
    const band = 0.025 + Math.max(1, config.grain) / Math.max(fieldExtent, 1) * 1.8;
    const [dx, dy] = directionVector(config.direction);
    const edgeTravel = p * Math.max(1, config.grain) * (1 + clamp01(config.edge) * 2.5);

    setThreshold('bodyThreshold', threshold);
    setThreshold('edgeThreshold', threshold + band);
    filter.set('displace', {
      scale: p * Math.max(1, config.grain) * (1.5 + clamp01(config.turbulence) * 4),
    });
    filter.set('edgeOffset', { dx: dx * edgeTravel, dy: dy * edgeTravel });
    filter.set('ashOffset', { dx: dx * edgeTravel, dy: dy * edgeTravel });
  }

  function paintFlecks(): void {
    if (context === null) return;
    const idle = progress <= 0 || progress >= 1 || width === 0 || height === 0;
    // Clearing dirties the canvas layer, so an idle endpoint only pays for it once.
    if (idle && !flecksDrawn) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    flecksDrawn = false;
    if (idle) return;

    let useSourceColour = false;
    if (config.color === undefined && shownMedia !== null && sourceContext !== null) {
      const sampleWidth = Math.max(1, Math.round(width));
      const sampleHeight = Math.max(1, Math.round(height));
      const needsSample =
        shownMedia instanceof HTMLVideoElement ||
        !sourceSampleReady ||
        shownMedia !== sampledMedia ||
        sampleWidth !== sampledWidth ||
        sampleHeight !== sampledHeight;
      if (needsSample) {
        if (sourceCanvas.width !== sampleWidth || sourceCanvas.height !== sampleHeight) {
          sourceCanvas.width = sampleWidth;
          sourceCanvas.height = sampleHeight;
        }
        sourceContext.clearRect(0, 0, sampleWidth, sampleHeight);
        sourceSampleReady = drawMediaCover(sourceContext, shownMedia, sampleWidth, sampleHeight);
        sampledMedia = shownMedia;
        sampledWidth = sampleWidth;
        sampledHeight = sampleHeight;
      }
      useSourceColour = sourceSampleReady;
    }
    context.fillStyle = fleckColour;
    for (const particle of particles) {
      const state = particleState(particle, progress, {
        width,
        height,
        drift: config.drift,
        turbulence: config.turbulence,
        direction: config.direction,
      });
      if (state.opacity <= 0) continue;
      flecksDrawn = true;
      context.globalAlpha = state.opacity;
      context.save();
      context.translate(state.x, state.y);
      context.rotate(state.rotation);
      context.scale(state.scale, state.scale);
      if (useSourceColour) {
        context.drawImage(
          sourceCanvas,
          particle.x - particle.size / 2,
          particle.y - (particle.size * particle.aspect) / 2,
          particle.size,
          particle.size * particle.aspect,
          -particle.size / 2,
          (-particle.size * particle.aspect) / 2,
          particle.size,
          particle.size * particle.aspect,
        );
      } else {
        context.fillRect(
          -particle.size / 2,
          (-particle.size * particle.aspect) / 2,
          particle.size,
          particle.size * particle.aspect,
        );
      }
      context.restore();
    }
    context.globalAlpha = 1;
  }

  function paint(): void {
    paintFilter();
    paintFlecks();
  }

  function applyConfig(): void {
    mountMedia();
    syncMediaActivity();
    fleckColour = config.color ?? getComputedStyle(body).color;
    filter.set('noise', {
      seed: config.seed,
      baseFrequency: (1 / Math.max(config.grain * 3.2, 2)).toFixed(5),
    });
    updateDirectionField();
    filter.set('ashFlood', {
      'flood-color': config.color ?? '#777777',
      'flood-opacity': config.color === undefined ? 0 : 0.92,
    });
    filter.set('naturalOpacity', { slope: config.color === undefined ? 1 : 0.08 });
    rebuildParticles();
  }

  const stopVisible = onVisible(host, (isVisible) => {
    visible = isVisible;
    syncMediaActivity();
  });
  const stopMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    syncMediaActivity();
    paint();
  });

  applyConfig();
  paint();

  return {
    setProgress(value: number): void {
      // Scroll progress arrives clamped, so the same 0 or 1 is reported for every
      // scroll event outside the mapped range; repainting on those is pure waste.
      if (value === progress) return;
      progress = value;
      paint();
    },

    setOptions(next: DissolveConfig): void {
      config = next;
      applyConfig();
      paint();
    },

    resize(): void {
      const nextWidth = stack.clientWidth;
      const nextHeight = stack.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      flecksDrawn = false;
      updateDirectionField();
      rebuildParticles();
      paint();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopMotion();
      if (shownMedia instanceof HTMLVideoElement) shownMedia.pause();
      filter.destroy();
      stopVisible();
      if (!initial.mediaRequested) {
        while (body.firstChild !== null) host.insertBefore(body.firstChild, stack);
        body.remove();
      }
      stack.remove();
    },
  };
}

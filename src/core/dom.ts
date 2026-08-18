/**
 * DOM plumbing every effect repeats: an overlay layer, visibility and size
 * observation so off-screen effects stop drawing, and media loaders that
 * resolve only once the pixels are actually uploadable to a texture.
 */

/**
 * Appends an absolutely-positioned, `pointer-events: none` element filling
 * `host`; promotes `host` to `position: relative` when statically positioned.
 */
export function createLayer<K extends keyof HTMLElementTagNameMap>(
  host: HTMLElement,
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const layer = document.createElement(tag);
  layer.className = className;
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.display = 'block';
  layer.style.width = '100%';
  layer.style.height = '100%';
  layer.style.pointerEvents = 'none';
  host.appendChild(layer);
  return layer;
}

/** IntersectionObserver wrapper; `visible` is true while any part intersects. */
export function onVisible(
  element: Element,
  listener: (visible: boolean) => void,
  rootMargin = '0px',
): () => void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) listener(entry.isIntersecting);
    },
    { rootMargin },
  );
  observer.observe(element);
  return (): void => observer.disconnect();
}

/** ResizeObserver wrapper reporting the content-box size in CSS px. */
export function onResize(
  element: Element,
  listener: (width: number, height: number) => void,
): () => void {
  const observer = new ResizeObserver((entries) => {
    // `contentRect` rather than `contentBoxSize`: the latter reports
    // inline/block extents, which swap under vertical writing modes.
    for (const entry of entries) listener(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(element);
  return (): void => observer.disconnect();
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const image = new Image();
  // Textures from tainted images throw on upload, so demand a CORS-clean fetch.
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.addEventListener('load', () => resolve(image), { once: true });
  image.addEventListener('error', () => reject(new Error(`Failed to load image: ${src}`)), {
    once: true,
  });
  image.src = src;
  return promise;
}

/**
 * Muted + playsInline + looping + autoplaying video, resolved once a frame is
 * decodable (`readyState >= HAVE_CURRENT_DATA`). A refused autoplay is
 * `console.warn`ed rather than swallowed, and the promise still resolves: the
 * first frame decodes either way.
 */
export function loadVideo(
  src: string,
  options: { poster?: string; loop?: boolean } = {},
): Promise<HTMLVideoElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLVideoElement>();
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  // `muted` must be set before playback is requested or autoplay is refused.
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.loop = options.loop ?? true;
  video.preload = 'auto';
  if (options.poster !== undefined) video.poster = options.poster;

  const settle = (): void => {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    video.removeEventListener('loadeddata', settle);
    video.removeEventListener('canplay', settle);
    resolve(video);
  };

  video.addEventListener('loadeddata', settle);
  video.addEventListener('canplay', settle);
  video.addEventListener('error', () => reject(new Error(`Failed to load video: ${src}`)), {
    once: true,
  });

  video.src = src;
  // A refused autoplay still decodes a first frame, which is all a texture
  // needs, so the promise still settles — but the reason is reported, because a
  // frozen background is otherwise indistinguishable from a broken effect.
  video.play().catch((error: unknown) => {
    console.warn(`Autoplay refused for ${src}; the first frame will be static.`, error);
  });
  return promise;
}

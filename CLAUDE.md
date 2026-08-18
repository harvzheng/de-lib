# CLAUDE.md — working rules for this repo

## What this is

An effects & transitions pack for the web: the browser equivalent of an effects pack for Premiere, After Effects, or DaVinci Resolve — film burns, filmstock grading, hand-drawn annotation — implemented as real CSS, HTML, SVG, Canvas, and (only where it earns its place) WebGL that composites over live DOM, images, and video instead of being baked into a render. Effects live under `src/effects/<slug>/`; shared runtime lives in `src/core/`; `src/effects/manifest.ts` is the single source of truth for what ships.

An entry qualifies as an effect only if it is a look or a transition (not a UI component), is drop-in via one factory call over existing markup, has zero runtime dependencies, degrades to a static unbroken frame, and ships a `demo.html`. If a proposed addition fails any of these, say so rather than building it.

## Rendering strategy — CSS/SVG/Canvas-first

This pack prefers, in order:

1. **Plain HTML + CSS** — transforms, blend modes, masks, custom properties.
2. **SVG filters**, driven from JS by setting attributes on filter primitives (see `src/core/svg.ts`).
3. **Canvas 2D.**
4. **WebGL**, only when 1–3 cannot do it — specifically, when the effect must *generate* a per-pixel field every frame rather than composite one.

Reasons this order is a hard rule and not a style preference: SVG filters apply to live DOM, which a WebGL canvas cannot touch in place; `feComponentTransfer` and `feColorMatrix` express per-channel film curves and channel cross-talk directly, which is most of what a film-stock grade is; and CSS/SVG output is inspectable in devtools and restyleable by the integrator, where a WebGL canvas is opaque.

Any effect that crosses into WebGL — the per-effect table below marks which ones do — must ship the **dual-renderer pattern**: a `renderer: 'auto' | 'webgl' | 'css'` option where `'auto'` prefers WebGL and falls back to the CSS/SVG renderer when WebGL2 is unavailable, the WebGL path in a `renderer-webgl.ts` that returns `null` when `createQuadRenderer` does, and an `activeRenderer: 'webgl' | 'css'` readback on the handle saying which one took the job. The CSS/SVG renderer is the floor that always works; WebGL is an optional upgrade on top of it, never the only path. Keep this table the single place that records which effects have a WebGL path.

Per-effect implementation:

| Effect | Implementation |
| --- | --- |
| `film-burn-transition` | WebGL renderer **and** a CSS/SVG renderer, selected via `renderer` option |
| `film-grain-video` | WebGL renderer **and** a Canvas 2D frame-hold + SVG filter grade renderer, selected via `renderer` option |
| `film-burn-overlay` | CSS blend-mode layers plus an SVG filter, no WebGL |
| `scribble-highlight` | SVG, no WebGL |
| `light-leak-transition` | WebGL renderer **and** a CSS/SVG blend-mode + filter renderer, selected via `renderer` option |
| `particulate-dissolve` | WebGL renderer **and** a CSS/SVG + Canvas 2D renderer, selected via `renderer` option |
| `subway-motion` | CSS blend-mode layers plus an SVG filter, no WebGL |
| `comic-print` | SVG filters plus CSS, no WebGL |
| `comic-impact` | SVG plus CSS, no WebGL |

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Vite dev server: gallery at the root, plus every `src/effects/*/demo.html` |
| `bun run check` | `tsc --noEmit` |
| `bun test` | Unit tests |
| `bun run build` | Site build (gallery + all demo pages) |
| `bun run build:lib` | Library build: `dist/lib/<slug>.js` + `dist/lib/<slug>.css` per effect |

`bun run check` and `bun test` must both pass before any work is called done. Report their actual output; do not assert success you have not observed.

## Hard invariants

- **Zero runtime dependencies.** Never add a dependency to `package.json`. No three.js, no gsap, no rough.js. Vite and TypeScript are build-time only.
- **ESM with named exports only.** No default exports, no CommonJS. `verbatimModuleSyntax` is on: type-only imports must use `import type { ... }`.
- **CSS/SVG/Canvas before WebGL**, per the rendering strategy above. WebGL requires a written justification (a per-pixel field the effect must generate) and a non-WebGL fallback renderer, not just a `null`-check bailout to static content.
- **Every effect exports one factory**, `create<Name>(target, options)`, returning an `Effect<Options>`.
- **`setOptions(patch)` merges and re-renders; `destroy()` is idempotent** and must release GPU resources, remove every listener, and detach every injected DOM node. Both must be safe to call after the effect is already torn down.
- **All animation goes through `onTick`** from `src/core/raf.ts`. Nothing outside `src/core/raf.ts` calls `requestAnimationFrame`.
- **All scroll scrubbing goes through `onScrollProgress`** from `src/core/scroll.ts`. Do not attach your own scroll listener.
- **All WebGL goes through `createQuadRenderer`.** A `null` return is a normal outcome, not an error: fall back to the CSS/SVG renderer, or to static content if the effect has none.
- **`prefers-reduced-motion: reduce` stops time-driven animation, not scroll-scrubbed motion.** Grain boil, ember flicker, gate weave, autoplaying video, and the scribble's boil/flutter stop and hold one representative frame. Scroll-scrubbed position mapping keeps responding to scroll — it is direct manipulation, not autonomous motion, and freezing it mid-scrub would strand the page half-transitioned. Autoplaying video pauses on one graded frame. Watch `onReducedMotionChange` so the OS toggle takes effect without a reload.
- **TypeScript is strict**, with `noUnusedLocals` and `noUnusedParameters` on. No dead code, no unused parameters.

## `src/core/` API reference

Authoritative signatures. Do not rediscover these by reading the source, and do not change them without being asked.

### `src/core/types.ts`

```ts
export interface EffectHandle {
  /** Removes listeners, releases resources, detaches injected DOM. Idempotent. */
  destroy(): void;
}
/** Every effect returns this, widened with its own option type. */
export interface Effect<Options> extends EffectHandle {
  /** Merges a partial patch over the current options and re-renders. */
  setOptions(patch: Partial<Options>): void;
}
```

### `src/core/math.ts`

```ts
export function clamp(value: number, min: number, max: number): number;
export function clamp01(value: number): number;
export function lerp(a: number, b: number, t: number): number;
export function smoothstep(edge0: number, edge1: number, x: number): number;
export function easeInOutCubic(t: number): number;
export function easeOutCubic(t: number): number;
/** Deterministic 32-bit PRNG (mulberry32). Same seed always yields the same sequence. */
export function mulberry32(seed: number): () => number;
/** Smooth 1D value noise from a seeded PRNG — a hand-drawn wobble, not white noise. */
export function seededWave(seed: number): (x: number) => number;
```

### `src/core/raf.ts`

```ts
export type TickListener = (now: number, deltaMs: number) => void;
/** Subscribes to the single shared rAF loop; loop starts on the first subscriber
 *  and stops when the last unsubscribes. Returns the unsubscribe function. */
export function onTick(listener: TickListener): () => void;
```

### `src/core/scroll.ts`

```ts
export interface ScrollProgressOptions {
  /** Viewport fraction the element's TOP edge sits at when progress = 0. Default 1 (viewport bottom). */
  start?: number;
  /** Viewport fraction the element's BOTTOM edge sits at when progress = 1. Default 0 (viewport top). */
  end?: number;
}
export interface ScrollProgressInput {
  scrollY: number;
  viewportHeight: number;
  /** Document-space top of the element (`rect.top + scrollY`). */
  elementTop: number;
  elementHeight: number;
  start: number;
  end: number;
}
/** Pure mapping, exported for tests:
 *  startY = elementTop - viewportHeight * start
 *  endY   = elementTop + elementHeight - viewportHeight * end
 *  result = clamp01((scrollY - startY) / max(endY - startY, 1)) */
export function scrollProgress(input: ScrollProgressInput): number;
/** Reports clamped 0..1 progress once immediately, then on scroll/resize
 *  (coalesced through the shared rAF tick). Returns the unsubscribe function. */
export function onScrollProgress(
  element: Element,
  listener: (progress: number) => void,
  options?: ScrollProgressOptions,
): () => void;
```

### `src/core/motion.ts`

```ts
export function prefersReducedMotion(): boolean;
/** Fires when the preference flips. Returns the unsubscribe function. */
export function onReducedMotionChange(listener: (reduced: boolean) => void): () => void;
```

### `src/core/dom.ts`

```ts
/** Appends an absolutely-positioned, `pointer-events: none` element of tag `K` that
 *  fills `host`; promotes `host` to `position: relative` when it is statically positioned. */
export function createLayer<K extends keyof HTMLElementTagNameMap>(
  host: HTMLElement,
  tag: K,
  className: string,
): HTMLElementTagNameMap[K];
/** IntersectionObserver wrapper; `visible` is true while any part intersects. */
export function onVisible(element: Element, listener: (visible: boolean) => void, rootMargin?: string): () => void;
/** ResizeObserver wrapper reporting the element's content-box size. */
export function onResize(element: Element, listener: (width: number, height: number) => void): () => void;
export function loadImage(src: string): Promise<HTMLImageElement>;
/** Muted + inline + looping + autoplaying video, resolved once a frame is decodable
 *  (`readyState >= HAVE_CURRENT_DATA`). Autoplay rejection is swallowed. */
export function loadVideo(src: string, options?: { poster?: string; loop?: boolean }): Promise<HTMLVideoElement>;
```

### `src/core/svg.ts` — the CSS-renderer workhorse

```ts
export interface FilterHandle {
  readonly id: string;
  /** `url(#id)`, ready for a CSS `filter` value. */
  readonly css: string;
  readonly element: SVGFilterElement;
  /** Updates attributes on the primitive tagged `data-p="name"`. Throws on a typo. */
  set(name: string, attributes: Record<string, string | number>): void;
  destroy(): void;
}
/** Parses an SVG <filter> fragment, gives it a unique id, appends it to a shared
 *  hidden <svg><defs> host, and returns a live handle. */
export function createFilter(markup: string, idPrefix: string): FilterHandle;
```

Any effect using CSS-side filters — which, per the rendering strategy, should be most of them — goes through `createFilter`. Author the `<filter>` fragment as a template string with `data-p="name"` on each primitive you intend to animate, then drive it frame-by-frame with `handle.set(name, attrs)` from an `onTick` listener.

### `src/core/gl.ts` — deliberately small; reached only from an effect's `renderer-webgl.ts`

```ts
export type ScalarUniform = number | boolean | readonly number[] | Float32Array;
export interface TextureOptions {
  /** UNPACK_FLIP_Y_WEBGL; default true so images sample upright against `vUv`. */
  flipY?: boolean;
  /** LINEAR when true (default), NEAREST otherwise. */
  linear?: boolean;
  wrap?: 'clamp' | 'repeat';
}
export interface QuadRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  /** Drawing-buffer size in device pixels, as of the last `resize()`. */
  readonly width: number;
  readonly height: number;
  /** Creates (first call) and uploads into the texture bound to sampler `name`.
   *  Callers control upload timing — this is how frame decimation is implemented. */
  upload(name: string, source: TexImageSource, options?: TextureOptions): void;
  /** Sets the named scalar/vector uniforms, binds every uploaded texture to its
   *  unit, and draws the fullscreen quad. Unknown or inactive names are ignored.
   *  `uResolution` (vec2, drawing-buffer px) and `uDpr` (float) are set
   *  automatically when the shader declares them. */
  render(uniforms?: Record<string, ScalarUniform>): void;
  /** Matches the drawing buffer to the canvas CSS box x clamped DPR. True when it changed. */
  resize(): boolean;
  dispose(): void;
}
export interface QuadRendererOptions {
  /** Device-pixel-ratio ceiling; default 2. */
  dprMax?: number;
  /** Default true, with premultipliedAlpha false. */
  alpha?: boolean;
  onContextLost?: () => void;
}
/** Compiles a fullscreen-quad WebGL2 program. Returns null when WebGL2 is
 *  unavailable or compilation fails (log goes to console.error); callers MUST
 *  fall back to their CSS/SVG renderer, or to static content if they have none. */
export function createQuadRenderer(
  canvas: HTMLCanvasElement,
  fragmentSource: string,
  options?: QuadRendererOptions,
): QuadRenderer | null;
```

### Fragment-shader prelude convention

This applies only to the WebGL renderer path — each effect's `renderer-webgl.ts` and the `shader.ts` beside it. Effect fragment shaders are authored **without** `#version`, `precision`, the `vUv` input, or the colour output. `createQuadRenderer` prepends exactly:

```glsl
#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
```

Writing any of those lines yourself is a compile error. `vUv` spans 0..1 with origin at the bottom-left (GL convention); `flipY: true` uploads mean images and video sample upright.

### `src/core/glsl.ts`

Also scoped to the WebGL renderer path. Reusable GLSL source chunks as exported template strings. Concatenate them ahead of your own body, **in this order** — later chunks depend on earlier ones:

```ts
export const GLSL_HASH: string;   // hash11, hash12, hash21, hash22
export const GLSL_NOISE: string;  // needs GLSL_HASH: vnoise2, fbm2(vec2, int octaves), ridged2
export const GLSL_GRAIN: string;  // needs GLSL_HASH: grain(vec2 uv, vec2 res, float t, float size) -> -1..1; applyGrain(vec3, float g, float strength) weighted so shadows/mids grain harder than highlights
export const GLSL_COLOR: string;  // luma, srgbToLinear, linearToSrgb, filmicToneMap, vignette(vec2 uv, float amount), bayerDither(vec2)
```

## Authoring conventions

- Before writing a shader, work through the rendering strategy in order: can plain CSS do it? Can an SVG filter via `createFilter` do it? Can Canvas 2D do it? Only reach for WebGL if the effect must generate a per-pixel field every frame.
- Shader sources are template strings in the effect's `index.ts`, or in a sibling `shader.ts` when they get long enough to crowd the logic. SVG filter markup follows the same rule.
- Effect styles go in `effect.css`, with every class name namespaced by the slug so two effects on one page cannot collide.
- Options are a single object parameter with documented defaults; state each default in the option's doc comment and in the effect's `README.md`.
- Comments state constraints the code cannot show — GPU limits, spec quirks, why a magic number is that number. No narration, no "this line does X", no notes about where a change came from.
- Match the surrounding style. Read the neighbouring effect before inventing a shape.
- Each effect owns its `README.md`. Do not document one effect's options anywhere else.

## Do not

- No frameworks. No React, Vue, Svelte, or anything that expects a runtime.
- No CSS-in-JS. Styles live in `.css` files.
- No build-step-only syntax in shipped effect code — decorators, experimental proposals, or anything that assumes a transform beyond the `es2022` target.
- No per-effect `requestAnimationFrame` loops.
- No silent `catch`. Either handle the failure meaningfully or let it throw.
- No reaching for WebGL before ruling out CSS, SVG filters, and Canvas 2D — see Rendering strategy.
- No unrequested refactors of `src/core/`. Effects depend on those signatures; changing them is a breaking change across the pack.
- No importing one effect from another, and no importing `src/demo/` from an effect — that directory is demo chrome only.

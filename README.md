# Web Effects Pack

This is an effects & transitions pack for the web — the same kind of thing you would buy as a pack for Premiere, After Effects, or DaVinci Resolve: film burns, filmstock looks, hand-drawn annotation. The difference is that nothing here is baked into a render; every effect is real CSS, HTML, SVG, Canvas, and (where it genuinely earns its place) WebGL, running in the browser and compositing live over your DOM, images, and video.

So a burn transition is not a video file you cut between two shots. It is a live filter running over two real elements on the page, scrubbed by the reader's scroll position. A 35mm regrade is not an export preset. It is a shader — or, without a GPU, an SVG filter and a Canvas 2D frame hold — sampling your `<video>` element every frame. The look is the same; the delivery mechanism is a web page.

## Rendering strategy

This pack is **CSS/SVG/Canvas-first, with WebGL only where per-pixel generated math genuinely requires it.** In order of preference:

1. **Plain HTML + CSS** — transforms, blend modes, masks, custom properties.
2. **SVG filters**, driven from JS by setting attributes on filter primitives.
3. **Canvas 2D.**
4. **WebGL**, only when 1–3 cannot do it.

That ordering is a design position, not a limitation:

- SVG filters apply to **live DOM** — a real `<video>`, a real image, real text — which a WebGL canvas cannot touch without first copying the content into a texture. `filter: url(#id)` composites in place.
- `feComponentTransfer` gives exact per-channel film curves and `feColorMatrix` gives channel cross-talk. That is most of what a film-stock grade actually *is*, and SVG expresses it directly instead of approximating it in a shader.
- CSS and SVG effects are inspectable in devtools and restyleable by whoever drops them into a page. A WebGL canvas is a black box; a `<filter>` element is not.

WebGL only earns its place when an effect has to **generate** a per-pixel field every frame — procedural noise, grain, a fragment-shader-driven burn front — rather than composite one. Four effects in this pack cross that line: the film burn transition, the filmstock video background, the particulate dissolve, and the light leak transition.

### The dual-renderer pattern

The film burn transition, the filmstock video background, the particulate dissolve, and the light leak transition all need a genuinely generated per-pixel field to look right, so each ships **two interchangeable renderers behind one factory**, selected with a `renderer: 'auto' | 'webgl' | 'css'` option and reported back on the handle as `activeRenderer`. `'auto'` (the default) prefers WebGL and falls back to the CSS/SVG renderer when WebGL2 is unavailable. For the dissolve, the CSS/SVG + Canvas 2D renderer works over arbitrary live DOM, while the WebGL renderer is a higher-fidelity upgrade reserved for images and video. For the light leak, the two renderers are matched by construction: both read the same staging module for the leak's geometry, so the WebGL path evaluates in closed form what the CSS path stacks as blurred gradient layers.

This is the sanctioned way to handle any effect that wants a WebGL path: the CSS/SVG renderer is the floor that must always work without a GPU, and WebGL is an optional upgrade layered on top, never a requirement. The CSS renderer for the burn transition is not a pre-rendered mask sequence — it thresholds a live `feTurbulence` field through `feComponentTransfer` and punches holes with `feComposite operator="in"`, with the threshold animated by setting filter-primitive attributes per frame. That keeps it drop-in over any two images or elements, the same as the WebGL path.

## What counts as an effect here

An entry ships in this pack only if all five hold:

1. **It is a look or a transition, not a UI component.** No dropdowns, no carousels, no layout systems. If it would be a plugin in an NLE, it belongs; if it would be a design-system component, it does not.
2. **It is drop-in.** One factory call over markup you already have. No wrapper elements you must hand-author, no required class scaffolding.
3. **It has zero runtime dependencies.** Not "few". Zero. Vite and TypeScript are build-time tools and never ship.
4. **It degrades to something static and unbroken.** No WebGL2, or the reader prefers reduced motion, and you still get a single representative frame with the underlying content fully visible. Never a blank box.
5. **It ships a demo page.** A real page you can open, scroll, and read the source of.

## Quick start

```sh
bun install
bun run dev
```

Open the URL Vite prints. The root page is the gallery, which lists every effect from the manifest and links to its demo. Demos live next to their effect at `src/effects/<slug>/demo.html`, so the demo you are reading and the code it exercises are the same files you would copy out.

## Catalogue

`src/effects/manifest.ts` is the single source of truth for what ships; the table below is the implementation behind each entry.

| Effect | Category | Implementation | Scroll-driven |
| --- | --- | --- | --- |
| **Film Burn Transition** — one shot burns away to reveal the next: amber ignition edge, charring, and blown-out highlights. | transition | WebGL, with a CSS/SVG fallback renderer (`renderer: 'auto' \| 'webgl' \| 'css'`) | Yes |
| **Filmstock Video Background** — any video regraded as Kodak Gold 200 35mm, with heavy moving grain, halation, gate weave, and a decimated frame rate for projector stutter. | background | WebGL, with a Canvas 2D frame-hold + SVG filter grade fallback renderer (`renderer: 'auto' \| 'webgl' \| 'css'`) | No |
| **Film Burn Overlay** — a sustained burn-and-light-leak layer over an image: holes bloom open, embers crawl, and the frame breathes as you scroll through it. | overlay | CSS blend-mode layers plus an SVG filter, no WebGL | Yes |
| **Scribble Highlight** — hand-drawn scribbles that draw themselves around any element, boil frame-by-frame like rough animation, then flutter away. | annotation | SVG, no WebGL | Yes |
| **Light Leak Transition** — a light leak carries the cut between two shots: a blown-out white flash hiding the change inside the flare, or translucent red, amber, and magenta bands sweeping across as the next shot crossfades underneath. | transition | WebGL, with a CSS/SVG blend-mode + filter fallback renderer (`renderer: 'auto' \| 'webgl' \| 'css'`) | Yes |
| **Particulate Dissolve** — the target crumbles into drifting ash and blows away, scrubbed by scroll and fully reversible. | transition | WebGL, with a CSS/SVG + Canvas 2D fallback renderer (`renderer: 'auto' \| 'webgl' \| 'css'`) | Yes |
| **Subway Motion** — a night train passing: tunnel lights streak past dark carriage glass, or a lit train sweeps across the foreground with windows strobing by. | overlay | CSS blend-mode layers plus an SVG filter, no WebGL | No |
| **Comic Print** — newsprint comic reproduction over any content: angled halftone dots, a posterised limited palette, ink misregistration, and paper grain. | overlay | SVG filters plus CSS, no WebGL | No |
| **Comic Impact** — a hand-inked starburst, speed lines, and an offset outline pop in behind your own text, then shake and exit. | annotation | SVG plus CSS, no WebGL | Yes |

Each effect's own `README.md` documents its options and defaults.

## Using an effect

There are two ways to take an effect, and they differ only in how the code reaches your page.

**Copy the source.** Take `src/effects/<slug>/` and `src/core/`, drop both into your project, and import the factory. This is the recommended route if you intend to tune the shaders, filters, or CSS — which you probably do, because that is the point of a pack.

**Build a single pair of files.** Run `bun run build:lib` and each effect becomes one self-contained ESM file plus one stylesheet in `dist/lib/`:

```
dist/lib/<slug>.js
dist/lib/<slug>.css
```

Ship that pair and nothing else. `src/core/` is bundled in, so there is no shared runtime to load first and no import order to get right.

Every effect exposes the same shape — a factory taking a target element and an options object, returning a handle that can update its own options and tear itself down:

```ts
import './effects/<slug>/effect.css';
import { createSomething } from './effects/<slug>';

const effect = createSomething(element, options);

// Change an option later without recreating the effect.
effect.setOptions({ intensity: 0.6 });

// Later — on unmount, route change, or teardown.
effect.destroy();
```

`destroy()` is idempotent: it releases any GPU resources, removes listeners, and detaches any DOM the effect injected. Calling it twice is safe, so you can wire it straight into a framework cleanup hook without guarding.

## Repository layout

```
index.html                     Gallery, rendered from the manifest
vite.config.ts                 Site build: gallery + every src/effects/*/demo.html
vite.lib.config.ts             Library build: one ESM + one CSS file per effect

src/
  core/                        Shared runtime. Zero deps, no effect-specific code.
    types.ts                     EffectHandle, Effect<Options>
    math.ts                      clamp, lerp, easings, mulberry32, seededWave
    raf.ts                       onTick — the single shared rAF loop
    scroll.ts                    onScrollProgress + the pure scrollProgress mapping
    motion.ts                    prefers-reduced-motion query and change events
    dom.ts                       layer creation, visibility/resize observers, image/video loading
    svg.ts                       createFilter — the CSS/SVG-renderer workhorse
    gl.ts                        createQuadRenderer — fullscreen-quad WebGL2, used by renderer-webgl.ts
    glsl.ts                      Reusable GLSL chunks: hash, noise, grain, color
  effects/
    manifest.ts                Single source of truth for what ships
    <slug>/
      index.ts                   Exports the create<Name> factory
      effect.css                 Styles, class names namespaced by slug
      demo.html                  Standalone demo page
      README.md                  Options, defaults, and notes for this effect
  demo/                        Demo chrome only — never imported by an effect
    demo.css
    controls.ts

public/
  media/                       Sample footage for the demos
```

The rule implied by that tree: effects depend on `src/core/`, and on nothing else. An effect never imports another effect, and never imports `src/demo/`.

## Adding a new effect

1. Create `src/effects/<slug>/`, using a kebab-case slug — it doubles as the library build output name.
2. Work through the rendering strategy in order: can plain CSS do it? Can an SVG filter do it? Can Canvas 2D do it? Only reach for WebGL, via `createQuadRenderer`, if the effect must generate a per-pixel field every frame that none of the above can express.
3. Write `index.ts` exporting a single named factory, `create<Name>(target, options)`, that returns an `Effect<Options>`.
4. Drive animation with `onTick` from `src/core/raf.ts`. Drive scroll scrubbing with `onScrollProgress` from `src/core/scroll.ts`. Do not open your own loop.
5. If you do reach for WebGL, handle `createQuadRenderer`'s `null` return by falling back to your CSS/SVG renderer, or to static content if there is none.
6. Check `prefersReducedMotion()` and stop time-driven animation when it is true, holding one representative frame; leave scroll-scrubbed position mapping running (see Compatibility below).
7. Make `destroy()` release everything: GPU resources, listeners, injected DOM. Verify it is safe to call twice. Make `setOptions()` merge a partial patch and re-render.
8. Put styles in `effect.css`, with every class name prefixed by the slug so two effects on one page cannot collide.
9. Write `README.md` for the effect: what it looks like, every option, and its default.
10. Add the entry to `src/effects/manifest.ts` — slug, title, category, blurb, tech, tags, `scrollDriven`, and the demo path.
11. Add `demo.html`. Both vite configs discover it automatically, so the gallery and the library build pick the effect up with no further wiring.

## Compatibility and accessibility

**WebGL2 is optional, not required.** The four effects that use it — the film burn transition, the filmstock video background, the particulate dissolve, and the light leak transition — treat it as an upgrade over their CSS/SVG (and, for the filmstock and the dissolve, Canvas 2D) renderers. When `createQuadRenderer` cannot get a context, or a shader fails to compile, it logs and returns `null`. All four treat that as a normal outcome, not an error: they fall back to their CSS/SVG renderer, which reproduces the same look without a GPU, and report `activeRenderer === 'css'`. A reader on a machine without WebGL2 sees the same effect, never a hole in the page.

**`prefers-reduced-motion: reduce` stops autonomous animation, not scroll-scrubbed motion.** The distinction matters:

- Time-driven animation — grain boil, ember flicker, gate weave, autoplaying video, the scribble's boil-and-flutter — stops, holding one representative frame.
- Scroll-scrubbed position mapping (the burn transition's ignite progress, the scribble's draw-on) keeps responding to scroll, because it is direct manipulation by the reader, not autonomous motion. Freezing it mid-scrub would strand the page in a half-transitioned state, which is worse than the motion it's meant to remove.
- Autoplaying video pauses and renders one graded frame instead of looping.
- Every effect also watches `onReducedMotionChange` at runtime, so flipping the OS setting takes hold without a reload.

**Sample media.** `public/media/sample-1920.mp4` and `sample-1280.mp4` are the same 6.7-second silent stock clip, originally 4096x2160, downscaled with ffmpeg to two delivery sizes; `sample-poster.jpg` is its poster frame. Demo footage only — it exists so the video effects have something to grade, and it is not part of what you would ship.

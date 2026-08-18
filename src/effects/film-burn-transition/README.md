# Film Burn Transition

One shot burns away to reveal the next. Holes open where a noise field first crosses the burn threshold, biased so the fire starts somewhere plausible rather than everywhere at once. Each hole's rim runs white-hot at the very edge, through amber, into a thin scorched ring; the paper just outside darkens and its highlights blow out as the heat arrives. At progress 0 the outgoing shot is clean; at progress 1 the incoming shot is clean.

It is scroll-scrubbed by default, and it pins itself: the host element is the scroll length, and the picture sticks to the viewport while you scroll through it.

```ts
import './effects/film-burn-transition/effect.css';
import { createFilmBurnTransition } from './effects/film-burn-transition';

const burn = createFilmBurnTransition(document.querySelector('#burn'), {
  from: '/media/shot-a.jpg',
  to: '/media/shot-c.jpg',
});
```

Give the host a height taller than the viewport — `height: 320vh` is a comfortable scrub. Anything at or below viewport height renders as a single frame you drive yourself.

## Options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `from` | `string \| HTMLImageElement \| HTMLVideoElement` | required | Outgoing media. A URL, or an element you already have on the page. |
| `to` | `string \| HTMLImageElement \| HTMLVideoElement` | required | Incoming media, revealed through the burn. |
| `renderer` | `'auto' \| 'webgl' \| 'css'` | `'auto'` | `'auto'` prefers WebGL and falls back to CSS when WebGL2 is unavailable. |
| `scroll` | `ScrollProgressOptions \| false` | `{ start: 0, end: 1 }` | Scroll mapping. `false` hands progress to you. |
| `progress` | `number` | `0` | Starting progress when `scroll` is `false`. |
| `burnColor` | `string` | `'#ff7a1a'` | Ignition colour at the burn edge. Any CSS colour. |
| `charColor` | `string` | `'#2a1206'` | Charred paper colour just behind the edge. |
| `edge` | `number` | `0.06` | Thickness of the glowing rim, 0..1 of the frame height. |
| `scale` | `number` | `3` | Burn-hole cell size, in cells across the frame height. Lower is bigger and blotchier. |
| `origin` | `'center' \| 'left' \| 'right' \| 'top' \| 'bottom' \| 'none'` | `'center'` | Where the burn starts. `'none'` lets the noise decide. |
| `grain` | `number` | `0.35` | Film grain over the composite, 0..1. |
| `seed` | `number` | `1` | PRNG seed. The same seed always burns the same way. |

A URL ending `.mp4`, `.webm`, `.ogv` or `.mov` is loaded as muted looping video; anything else is loaded as an image. Elements you pass are used where they are — the effect never moves them out of your layout.

## Handle

```ts
burn.setOptions({ edge: 0.1, renderer: 'css' }); // merges and re-renders; swaps renderers in place
burn.setProgress(0.5);                           // only meaningful when scroll is false
burn.activeRenderer;                             // 'webgl' | 'css'
burn.destroy();                                  // idempotent
```

`destroy()` releases the GPU program and textures, removes the SVG filter, unsubscribes from scroll, resize, visibility and reduced-motion, and detaches every node the effect injected. Calling it twice is safe, and `setOptions`/`setProgress` after it are no-ops.

## The two renderers

This is the only effect in the pack that ships two. They are not a fast path and a stub — both generate the burn field live, every frame, from the same options.

**WebGL** (`createQuadRenderer`, one fullscreen quad). The field is an fbm sampled per pixel, so `fwidth` gives the field's local gradient and the rim is converted to an exact fraction of the frame height wherever it lands. Both shots are textures with cover-fit computed in the shader from their pixel dimensions, grain is generated per pixel at 24 exposed frames per second, and the composite is dithered before the 8-bit write.

**CSS/SVG** (one `createFilter`, animated by writing attributes on primitives tagged `data-p`). A live `feTurbulence` is normalised by `feComponentTransfer`, biased toward the origin by an `feComposite operator="arithmetic"` against a blurred `feFlood`, then thresholded five times into a hole plus four concentric bands. The hole is punched with `feComposite operator="in"` against `SourceGraphic`; each band is isolated with `operator="out"` against the hole mask and filled with `feFlood`, with the rim blurred for glow. Only the five threshold ramps and four flood opacities move per frame.

What the CSS renderer gives up:

- **Rim thickness is approximate.** Nothing in SVG filters reports the field's local gradient, so `edge` is converted to field units by a flat factor with a ceiling. Where the field is shallow the rim reads wider than the WebGL one, and a large `edge` on a low `scale` fills rather than outlines.
- **The two do not match pixel for pixel.** `feTurbulence` is not `fbm2`; the holes are in different places for the same seed. They ignite at the same progress, in the same region, with the same rim structure, and both are clean at 0 and 1.
- **No per-pixel grain.** Grain is a tiling turbulence layer in `mix-blend-mode: overlay`, stepped between offsets at 24fps rather than regenerated.
- **The glow spills into the hole.** `feGaussianBlur` blurs both ways, so the rim tints the revealed shot slightly. The WebGL rim does not.
- **A video source is decoded twice** if you pass an element that is already in the page, because the stack builds its own `<video>` rather than moving yours.

What it gains: it works with no GPU, it is inspectable and restyleable in devtools, and it composites live DOM rather than a texture copy.

`renderer: 'webgl'` still falls back to CSS with a console warning when WebGL2 is unavailable — the effect never leaves a hole in the page.

## Reduced motion

`prefers-reduced-motion: reduce` stops the time-driven parts: grain boil and ember flicker hold one frame, and video sources pause. Scroll scrubbing keeps responding, because it is direct manipulation rather than autonomous motion — freezing it would strand the page half-transitioned. The preference is watched at runtime, so flipping the OS setting takes effect without a reload.

## Styling

Every class is namespaced by the slug. The pinned frame reads one custom property:

```css
#burn { --film-burn-pin-top: 4rem; } /* clear a fixed header */
```

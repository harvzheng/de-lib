# Bokeh

Defocused highlights sitting in front of whatever is already on the page — discs with a soft penumbra, a faint rim cooler than their core, laid out in depth, shimmering as the reader scrolls.

The discs are **placed on the content**, not scattered over it. The effect rasterises the host's image or video once into a 96px-wide scratch canvas, finds the bright locally-isolated points in it, and puts one disc on each, inheriting that point's colour and brightness. A street lamp in the picture becomes a lamp-shaped bokeh; a dim reflection becomes a dim disc. That is why it reads as belonging to the frame rather than as a decal on top of it.

A disc that sits on a highlight stays there — a lamp does not slide across the frame because the reader scrolled — so on anchored discs the scroll response is the shimmer, and only free discs drift vertically. The shimmer itself is driven by scroll position rather than a clock: scrolling is what makes the field sparkle, and a still page only glimmers at whatever `drift` you set. That is also why it stays alive under `prefers-reduced-motion`: the autonomous sway stops, the scroll response does not.

This is a standing overlay, not a transition. It never completes, and it composites over live DOM — a real image, a real `<video>`, real text — rather than over a copy of it.

## Implementation

`highlights.ts` is the detector: luma, a separable box blur for the local mean, then a score of local contrast times absolute brightness, non-maximum suppressed against a minimum separation. Contrast alone promotes every hard edge and brightness alone promotes the whole sky; a defocused disc needs both. It is pure — pixels in, highlights out — and `index.ts` does the rasterising, mapping the result through the media's own box and `object-fit` so a detected highlight lands on the pixel the reader can see.

**There is exactly one readback, on mount, on source change and on resize.** Nothing in the per-frame path touches pixels. A cross-origin image taints the canvas and `getImageData` throws; that is a normal deployment rather than a bug, so it is caught, warned once, and the field falls back to seeded free placement.

`discs.ts` turns anchors plus a seed into the disc list, and resolves each disc's position, brightness and shimmer as a pure function of `(seed, identity, progress, time)`. Nothing accumulates, so scrubbing back up the page reconstructs exactly the frame it drew on the way down.

Both renderers consume that one list, so they agree on layout:

- **WebGL** uploads the list as uniforms (`vec4` per disc: position, radius, brightness) and draws it per pixel. That is what buys real polygonal aperture blades, chromatic fringing on the rim, and overlapping discs that roll off exponentially instead of clipping to white. The canvas is opaque black composited with `mix-blend-mode: screen`, where black is the identity — a straight-alpha canvas over live DOM composites slightly differently in Blink and Gecko, and screen over black has no alpha for them to disagree about.
- **CSS** paints one element per disc, each a single `radial-gradient`. The falloff is a gradient stop rather than a `filter: blur()`, so a disc rasterises once and every frame after that costs one `transform` and one `opacity` write on an already-promoted layer.

## Usage

```ts
import './effects/bokeh/effect.css';
import { createBokeh } from './effects/bokeh';

const effect = createBokeh(host, {
  source: 'auto',
  follow: 0.9,
  count: 20,
  size: 0.16,
  softness: 0.7,
});

effect.activeRenderer; // 'webgl' or 'css'
effect.anchoredCount;  // how many discs found a highlight

effect.setOptions({ blades: 6, intensity: 0.6 });

// Later — on unmount, route change, or teardown.
effect.destroy();
```

`host` is any element. Its own content stays exactly where it was; the overlay is appended inside it, `aria-hidden`, and never takes pointer events. A statically positioned host is promoted to `position: relative` so the discs are laid out in its box.

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `renderer` | `'auto' \| 'webgl' \| 'css'` | `'auto'` | `'auto'` prefers WebGL and falls back to CSS when WebGL2 is unavailable. |
| `source` | `'auto' \| 'none' \| string \| HTMLImageElement \| HTMLVideoElement` | `'auto'` | Where highlights are read from. `'auto'` takes the first `<img>` or `<video>` inside the host; a string is a document selector; `'none'` skips detection entirely. |
| `follow` | `number` | `0.9` | The share of the field that snaps onto detected highlights, 0..1, taken from the far depth planes first — the nearest discs stay free, which is where foreground bokeh comes from. An anchored disc sits exactly on its highlight, never partway toward it. At `0` nothing is anchored and no disc inherits a highlight's colour or brightness. |
| `tintFromSource` | `boolean` | `true` | Give each anchored disc its own highlight's colour instead of a `tints` entry. |
| `scroll` | `ScrollProgressOptions \| false` | `{ start: 1, end: 0 }` | The scroll mapping (see `src/core/scroll.ts`). Pass `false` to drive progress yourself. |
| `progress` | `number` | `0` | Starting progress when `scroll` is `false`. |
| `count` | `number` | `20` | Number of discs, capped at 64. More discs than highlights reuses them, each reuse offset into a cluster and less firmly anchored. |
| `size` | `number` | `0.16` | Base disc diameter as a fraction of the host's short side. |
| `variance` | `number` | `0.55` | Diameter spread, 0..1, applied on top of the depth scaling so it never flattens the depth ordering. |
| `softness` | `number` | `0.7` | Edge falloff: 0 is a hard aperture cut, 1 is pure diffuse glow. Most of the radius is penumbra at the default; the interior keeps a flattened plateau so a soft disc still reads. |
| `rim` | `number` | `0.28` | Brightness of the ring inside the disc edge, 0..1. |
| `blades` | `number` | `0` | Aperture blades: `0` for round, `3`–`9` for polygonal. WebGL renderer only. |
| `intensity` | `number` | `0.7` | Overall disc brightness, 0..1, before each disc's own highlight weight (0.62–1.0 by how strong its highlight was). |
| `shimmer` | `number` | `0.7` | Shimmer depth, 0..1. At 0 the discs hold a steady brightness. |
| `shimmerRate` | `number` | `7` | Twinkles per disc across the whole scroll range. Each disc scales this by its own 0.55–1.9 multiplier, so the field never pulses in unison. |
| `parallax` | `number` | `0.6` | Vertical travel across the scroll range, in host heights, for free discs. Anchored discs travel 12% of it at most, and depth scales the rest (0.35× far to 1.25× near). |
| `drift` | `number` | `0.05` | Idle sway and shimmer crawl, in cycles per second. Time-driven, so this is the term reduced motion stops. `0` removes the tick entirely and every disc sits exactly where it was placed. |
| `tints` | `string[]` | `['#ffcf8f', '#ff9fc4', '#8ecaff', '#fff0c2']` | Palette for discs with no highlight colour of their own. |
| `seed` | `number` | `1` | PRNG seed. Same seed, same field. |

## Handle

Beyond the standard `setOptions(patch)` and `destroy()`:

- `setProgress(progress)` — drives the field manually, 0..1. Only meaningful when `scroll` is `false`; while `scroll` is active the next scroll or resize event overwrites whatever it sets.
- `resample()` — re-reads highlights from the source. Detection already reruns on mount, on `source` change, on resize, and when an `<img>` loads or a `<video>` fires `loadeddata`/`seeked`. Call this when the source's pixels changed without any of those, such as a canvas you paint into yourself.
- `activeRenderer` — `'webgl'` or `'css'`, whichever took the job.
- `anchoredCount` — how many discs are sitting on a detected highlight rather than placed freely. `0` means detection found nothing usable and the field is free.

## What the CSS renderer gives up

- **Aperture blades.** `blades` is ignored; every disc is round. A polygonal disc would need either a `clip-path` per element (which fights the gradient falloff) or an SVG filter per disc.
- **Chromatic fringing.** The rim brightens toward white rather than running cool, because a single gradient cannot shift hue and brightness independently along one stop.
- **Highlight roll-off.** Overlapping discs composite with `screen` instead of the WebGL path's exponential roll-off, so a dense field saturates sooner.

Placement, colour, brightness, shimmer and drift are identical between the two — they read the same disc list.

## Performance

Measured on an M3 Max with a real GPU in all three engines, over a synthetic 90-step instant-jump scrub at 1280x800 (median/p95 ms per frame, where 8.34ms is the display refresh floor):

| renderer | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| WebGL | 8.3/9.3 | 8.34/9.2 | 17/18 |
| CSS | 8.3/8.9 | 8.34/25 | 17/18 |

The one soft spot is the CSS renderer in Firefox, and it is overdraw: anchored discs overlap by construction — one lamp, several discs — and each is a large semi-transparent layer composited inside a `mix-blend-mode: screen` group. The same field with `follow: 0`, which spreads the discs out, measures 8.34/16.7 with no frame over 20ms. Neither dropping `will-change` (8.34/25) nor widening the highlight separation moved it, so it is fill rate rather than layerisation. It only affects machines without WebGL2, since `'auto'` prefers the shader; lower `count`, lower `size`, or `follow: 0` all bring it back under the frame budget.

## Accessibility and reduced motion

The overlay is `aria-hidden="true"` and `pointer-events: none`; the host's own content keeps its accessible name and stays selectable.

With `prefers-reduced-motion: reduce`, the time-driven terms — the sway and the slow shimmer crawl — stop, and the field holds its resting frame. Scroll-scrubbed shimmer and free-disc parallax keep responding, since that is direct manipulation by the reader rather than autonomous motion. The preference is watched at runtime, so toggling it in system settings takes effect without a reload.

Without WebGL2, `createQuadRenderer` returns `null`, the factory logs and builds the CSS renderer instead, and `activeRenderer` reports `'css'`.

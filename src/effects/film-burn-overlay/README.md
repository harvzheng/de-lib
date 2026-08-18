# Film Burn Overlay

A sustained burn-and-light-leak treatment over a single image. Holes bloom open and stay charred, embers crawl and flicker along their rim, light leaks sweep across the frame and drift slowly over time, and the image itself drifts and swells slightly as the reader scrolls through it. Think of a strip of film that sat too long in the gate, not a cut between two shots — this never completes, it lives on top of the image indefinitely.

It differs from the film burn *transition* in exactly that way: the transition burns one shot away to reveal another and finishes; this is a standing treatment on one image, driven back and forth by scroll.

## Implementation

CSS layers, blend modes, and one shared SVG filter (`feTurbulence` + `feDisplacementMap`, via `createFilter`) that roughens the char and ember edges so the holes read as burnt paper, not clip art circles. No canvas, no WebGL — every layer is inspectable in devtools and restyleable in `effect.css`.

Everything is driven by two custom properties written on the stage element — `--p` (scroll/manual progress) and `--t` (elapsed seconds, for flicker and drift) — plus, per hole, a handful of properties written once when the hole geometry is built. CSS `calc()` and `color-mix()` do the rest, so scrubbing the page only ever touches one or two properties on one element.

## Usage

```ts
import './effects/film-burn-overlay/effect.css';
import { createFilmBurnOverlay } from './effects/film-burn-overlay';

const effect = createFilmBurnOverlay(host, {
  intensity: 0.7,
  leak: 0.6,
  holes: 4,
});

effect.setOptions({ intensity: 0.9 });

// Later — on unmount, route change, or teardown.
effect.destroy();
```

`host` is any element. If it already contains an `<img>`, omit `src` and that image is treated in place — it is hidden (not removed, so it keeps sizing the host if nothing else does) and a copy is drawn inside the effect's own stage. If `host` has no `<img>`, pass `src` and the effect draws its own.

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `src` | `string` | — | Image URL. Omit to treat an `<img>` already inside `host`. |
| `scroll` | `ScrollProgressOptions \| false` | `{ start: 1, end: 0 }` | The scroll mapping (see `src/core/scroll.ts`). Pass `false` to drive progress yourself via `setProgress`. |
| `progress` | `number` | `0` | Starting progress when `scroll` is `false`. |
| `intensity` | `number` | `0.7` | Overall strength of the char and ember layers, 0..1. |
| `leak` | `number` | `0.6` | Light-leak strength, 0..1. |
| `holes` | `number` | `4` | Number of burn-through holes, 0..8. |
| `ember` | `number` | `0.7` | Ember rim brightness, 0..1. |
| `parallax` | `number` | `60` | Vertical drift of the image across the scroll range, in px. |
| `zoom` | `number` | `0.08` | Extra image scale at progress 1. |
| `grain` | `number` | `0.4` | Grain strength, 0..1. |
| `burnColor` | `string` | `'#ff7a1a'` | Ignition/ember colour. |
| `charColor` | `string` | `'#1b0d05'` | Charred-hole colour. |
| `flicker` | `boolean` | `true` | Whether embers flicker over time. |
| `seed` | `number` | `1` | PRNG seed. Same seed, same hole layout. |

## Handle

Beyond the standard `setOptions(patch)` and `destroy()`, this effect adds:

- `setProgress(progress)` — drives the treatment manually, 0..1. Only meaningful when `scroll` is `false`; while `scroll` is active, the next scroll or resize event overwrites whatever it sets.

## Accessibility and reduced motion

The overlay is purely decorative (`aria-hidden="true"`) and never intercepts pointer events; the host's original image keeps its accessible name.

With `prefers-reduced-motion: reduce`, ember flicker, light-leak drift, and grain animation all stop and hold their resting frame — but scroll-scrubbed progress keeps responding to scroll, since that is direct manipulation by the reader, not autonomous motion. The preference is watched at runtime, so toggling it in system settings takes effect without a reload.

This effect never uses WebGL2 — it is CSS, blend modes, and one SVG filter, so it runs identically with or without a GPU.

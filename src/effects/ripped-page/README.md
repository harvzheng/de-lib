# Ripped Page

The shot on screen is a printed page. It tears across, the fibres let go in bundles, and the two halves hinge off one end of the rip and pull away to reveal the next shot, which settles out of a punch-in behind them.

Cut in the travel-edit idiom: the tear holds still, snaps, then decelerates. That is two curves, not one — the hinge opens early and eases out, while the halves only leave late — so a scroll scrub is spent on the rip itself rather than on two rectangles travelling off-frame.

## Implementation

No WebGL and no baked mask sequence. `tear.ts` generates the rip once as a deterministic polyline using **1D midpoint displacement**, because a tear in paper is self-similar: every scale of the edge looks like the scale above it, since the fibres fail in bundles. Smooth value noise gives a wobbly line; recursive displacement gives one that reads as paper.

That single polyline is then used three ways:

1. As a `clip-path` polygon on each half — the two polygons share the rip, so one half's edge is exactly the other's.
2. As the `d` of an SVG path stroked in the paper's own stock colour, drawn *inside* each half. The half's clip cuts the outer half of that stroke away, which is what leaves a hard fibrous edge on the paper and nothing hanging outside it. One shared `feTurbulence` + `feDisplacementMap` roughens the stroke so it reads as fibre rather than as a stroked polyline.
3. As the shadow the torn edge casts into the gap, blurred by one shared `feGaussianBlur`.

Both halves hinge on the same pivot, which is what opens the rip as a widening wedge; rotating about their own centres would slide them apart in parallel, which reads as two panels rather than as paper coming away in the hand.

Because the clip is static and the halves hinge, **every frame writes nothing but `transform` and `opacity`** — five writes total. Geometry is rebuilt only on mount, on resize, and when a tear option changes.

## Usage

```ts
import './effects/ripped-page/effect.css';
import { createRippedPage } from './effects/ripped-page';

// The host is the scroll length; the effect pins the picture inside it.
const rip = createRippedPage(host, {
  from: '/media/shot-a.jpg',
  to: '/media/shot-c.jpg',
  angle: -7,
  roughness: 0.55,
  fiber: 0.5,
});

// Drive it yourself instead of by scroll.
rip.setOptions({ scroll: false });
rip.setProgress(0.5);

// Later — on unmount, route change, or teardown.
rip.destroy();
```

`host` is the scroll length: the effect pins a frame inside it with `position: sticky`, so a host taller than the viewport scrubs the tear while the picture stays put. A host no taller than the viewport takes its own height and the sticky never engages.

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `from` | `string \| HTMLImageElement \| HTMLVideoElement` | — | The outgoing shot — the page that tears. A URL loads an image, or a video when the URL ends in a video extension. |
| `to` | `string \| HTMLImageElement \| HTMLVideoElement` | — | The incoming shot, revealed through the rip. |
| `scroll` | `ScrollProgressOptions \| false` | `{ start: 0, end: 1 }` | The scroll mapping (see `src/core/scroll.ts`). Pass `false` to drive progress yourself. |
| `progress` | `number` | `0` | Starting progress when `scroll` is `false`. |
| `axis` | `'horizontal' \| 'vertical'` | `'horizontal'` | Which way the rip runs. |
| `angle` | `number` | `-7` | Tilt of the rip in degrees, clamped to ±35. Past that a tilted rip runs off the end of the frame before it crosses. |
| `offset` | `number` | `0.52` | Where the rip crosses the frame, 0..1. |
| `roughness` | `number` | `0.55` | How far the rip wanders, 0..1, as a fraction of the frame. |
| `fiber` | `number` | `0.5` | Length of the fibre tufts standing out of the edge, 0..1. Each tuft leaves a matching notch in the other half. |
| `pivot` | `'start' \| 'end' \| 'center'` | `'start'` | Which end of the rip the halves hinge on. |
| `edge` | `number` | `3` | Width of the torn paper edge in px. Also sets the shadow's blur, since the two read as one sheet thickness. |
| `edgeColor` | `string` | `'#fdf6e8'` | Colour of that edge — the paper's own stock, not its print. |
| `separation` | `number` | `0.95` | How far the halves travel at full tear, in frame heights (widths, on a vertical rip). |
| `rotation` | `number` | `9` | Counter-rotation of the halves at full tear, in degrees. |
| `hold` | `number` | `0.12` | Scroll fraction the rip waits before it lets go, 0..0.6. This is the snap. |
| `zoom` | `number` | `0.12` | Punch-in the revealed shot settles out of, 0..0.4. |
| `shadow` | `number` | `0.55` | Depth of the shadow the torn edges cast into the gap, 0..1. |
| `grain` | `number` | `0.3` | Paper grain over the frame, 0..1. |
| `seed` | `number` | `1` | PRNG seed. Same seed, same rip. |

## Handle

Beyond the standard `setOptions(patch)` and `destroy()`:

- `setProgress(progress)` — drives the tear manually, 0..1. Only meaningful when `scroll` is `false`; while `scroll` is active the next scroll or resize event overwrites whatever it sets.

## Notes and limits

- **The outgoing page is drawn twice.** One media element cannot be clipped two ways, so each half carries its own copy. For an image that is one decode and one shared cache entry; for a video it is a second decode, which is the cost of tearing live footage.
- **The rip is not re-cut while scrubbing.** Regenerating the clip polygons per frame would repaint both halves every frame; hinging static clips gives the same read for the price of a transform.
- **`clip-path` polygons are in px**, so geometry is rebuilt on resize. That is a `ResizeObserver` callback, not a scroll-frame cost.

## Accessibility and reduced motion

The stack is `aria-hidden="true"` and never intercepts pointer events; whatever the host contains keeps its accessible name.

This effect has **no time-driven animation at all** — there is no grain boil, no flutter, nothing on a clock. The only motion is the scroll-scrubbed tear, which is direct manipulation by the reader rather than autonomous motion, so `prefers-reduced-motion: reduce` leaves it responding to scroll exactly as before. Nothing needs to stop, so nothing does.

It never uses WebGL2: it is `clip-path`, transforms, and two SVG filters, so it runs identically with or without a GPU.

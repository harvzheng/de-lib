# Street Light

A fixed street lamp and one pool of light. The reader scrolls the host beneath
it: a paragraph, photograph or figure is dark before it reaches the lamp,
brighter and warmer while it is under the throw, then dark again after it has
passed. The lamp holds one line in the viewport; the content moves.

## Why the content is actually lit

The pool is not a coloured disc laid over the host. Three layers blend against
the host's own pixels, bottom to top:

1. **Night** — a blue-grey `multiply` over the visible part of the host, with a
   soft elliptical opening where the throw lands. Multiply takes light away and
   pulls the hue toward the night colour. That is the difference between night
   and a neutral vignette.
2. **Contrast** — a warm `overlay` inside the throw. Overlay multiplies dark
   host pixels and screens light ones, so shadows keep weight while highlights
   lift. This is what stops the pool reading as a translucent sticker.
3. **Light** — a warm `screen` inside the throw: the hot lens, a compact hotspot,
   the ground pool and a longer dim tail. Screen can only add, so this is what
   visibly brightens whatever is under the lamp.

An optional fourth `screen` layer draws light in mist. It uses a feathered
`conic-gradient` for the widening shaft and a radial-gradient mask for distance
falloff. It does not use the old blurred `clip-path`: CSS filters run before
clipping, so clipping a blurred layer discards the blur at the boundary and
produces a hard plastic wedge.

**The stack deliberately does not isolate.** `isolation: isolate`, `opacity`,
`filter`, `mask`, `clip-path`, `contain` or `transform` on the stack or an
intermediate wrapper makes its children blend against a transparent group
instead of the host. Transforms and masks are safe on the blended children,
which are already groups in their own right.

## Fixed-lamp placement

`onScrollProgress` supplies progress $p$ using the core mapping:

```text
span = hostHeight + viewportHeight * (start - end)
viewportTopInHost = p * max(span, 1) - viewportHeight * start
```

The effect lays the light out once in a viewport-sized band. If `margin` is the
small safety margin around that band, its host-space top is:

```text
bandTop = viewportTopInHost - viewportHeight * margin
```

The lens sits inside the band at:

```text
lensY = viewportHeight * (margin + anchor)
```

Subtracting the viewport top leaves exactly
`viewportHeight * anchor`, independent of progress. The host therefore walks
under a lens that does not move in the reader's frame.

`scroll: false` uses the same inverse mapping. Switching from a custom scroll
mapping to manual control retains that mapping, so passing the current
`progress` back produces the same transform exactly.

## Rendering and performance

`lamp.ts` owns the pure geometry: the viewport band, fixture, hotspot, pool,
tail, mist and the host-space band offset. `index.ts` writes that geometry into
CSS custom properties only on option or size changes.

Scroll changes only `translate3d()` on already-promoted blend layers. It does
not rewrite a gradient. The `overlay` and `screen` throw layers are bounded to
the pixels their gradients can reach instead of being host-sized; the fixture
is bounded to its hardware; only night covers the viewport. This matters in
Gecko and WebKit, where changing a property on a filtered element can
re-rasterise the entire element.

The mist defaults off. It reads as soft light in air when enabled, but it is a
fourth backdrop blend. Keeping the default picture to night, contrast and light
is what preserves a one-refresh-interval scroll scrub in Firefox. Sway and buzz
are also opt-in: a fixed street fixture is still by default, and autonomous
motion should not consume frames unless the caller asks for it.

## Usage

```js
import { createStreetLight } from './effects/street-light';

const lamp = createStreetLight(document.querySelector('article'), {
  anchor: 0.24,
  column: 0.4,
  light: '#ffc27a',
  night: '#4a5c80',
});

// Drive the same placement yourself instead of by scroll.
lamp.setOptions({ scroll: false, progress: 0.35 });
lamp.setProgress(0.62);

lamp.destroy();
```

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `scroll` | `ScrollProgressOptions \| false` | `{ start: 1, end: 0 }` | Core scroll mapping. `false` hands progress to the caller. The last active custom mapping is retained for exact manual placement. |
| `progress` | `number` | `0` | Placement when `scroll` is `false`, clamped to 0..1. |
| `anchor` | `number` | `0.24` | Viewport fraction where the lens holds. `0.24` is in the upper quarter, leaving room for the throw below. |
| `column` | `number` | `0.4` | Horizontal position across the host, 0..1. |
| `drop` | `number` | `0.3` | Lens-to-pool distance as a fraction of viewport height. |
| `spread` | `number` | `0.19` | Pool half-width as a fraction of the lesser of host width and viewport height. |
| `stretch` | `number` | `1.45` | Pool length over pool width. Values below 1 are floored at 1. |
| `glow` | `number` | `0.9` | Illumination strength, 0..1, shared by the `overlay` and `screen` throw layers. |
| `depth` | `number` | `0.82` | Night depth, 0..1. It interpolates the multiply colour from white toward deep blue-grey rather than fading a fixed tint in. |
| `light` | `string` | `'#ffc27a'` | Any CSS colour, from sodium orange to LED white. |
| `night` | `string` | `'#4a5c80'` | Night hue. Blue-grey preserves the colour separation that black would erase. |
| `fixture` | `boolean` | `true` | Draw the mast, arm, lamp head and hot lens. `false` leaves only the light. |
| `cone` | `number` | `0` | Mist strength, 0..1. `0` removes the fourth blend layer; nonzero enables the soft gradient shaft. |
| `sway` | `number` | `0` | Autonomous sway amplitude in pixels. `0` keeps the fixture still. |
| `buzz` | `number` | `0` | Autonomous brightness variation, 0..1. `0` keeps a steady lamp. |

Beyond `Effect<StreetLightOptions>`:

- `setProgress(progress)` changes manual placement immediately, clamped to 0..1.
- `progress` reads the current scroll or manual placement.

## Accessibility, reduced motion and cleanup

The host's markup is untouched: selection, links, accessible names and reading
order remain its own. The stack, five visual layers and fixture hardware are
`aria-hidden`; all take no pointer events.

With `prefers-reduced-motion: reduce`, sway and buzz stop at the lamp's rest
frame and brightness holds at 1. Scroll and `setProgress()` keep moving the
throw because they are direct manipulation. The preference is watched at
runtime, so changing it takes effect without a reload.

`destroy()` unsubscribes scroll, resize, visibility, tick and motion-preference
listeners, removes every injected node, and restores the host's original inline
`position`. It is idempotent. The effect creates no SVG filter and leaves no
filter definitions behind.

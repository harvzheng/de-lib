# Light Leak Transition

A scroll-scrubbed transition between two live images or videos. A warm, edge-fogged film leak crosses the frame while the outgoing shot gives way to the incoming one. It ships two renderers behind one factory: a fragment shader that evaluates the whole leak per pixel, and a CSS/SVG renderer that stacks blurred gradients with blend modes over live media. Neither uses baked transition footage or runtime dependencies.

Import the stylesheet once, then create the effect over a host. The host supplies the scroll length; the picture inside it stays pinned while the default scroll mapping runs from 0 to 1.

```ts
import './effects/light-leak-transition/effect.css';
import { createLightLeakTransition } from './effects/light-leak-transition';

const leak = createLightLeakTransition(document.querySelector('#transition'), {
  from: '/media/shot-a.jpg',
  to: '/media/shot-c.jpg',
  style: 'flash',
  direction: 'left',
});

leak.setOptions({ style: 'sweep', warmth: 0.7 });
leak.destroy();
```

## Styles

- **`flash`** is an overexposure cut. The leak raises and desaturates the outgoing shot toward white, recruits its highlights into an amber halation bleed, hides the shot swap around the flare peak, then recedes to reveal the clean incoming shot.
- **`sweep`** keeps the frame readable. Three seeded red, amber, and magenta bands move at different speeds and angles with `screen` and `color-dodge` blending while the incoming shot crossfades underneath.

Both styles are clean at their endpoints: progress 0 is the untouched outgoing shot and progress 1 is the untouched incoming shot.

## API

```ts
export type LeakRenderer = 'auto' | 'webgl' | 'css';
export type LeakStyle = 'flash' | 'sweep';
export type LeakDirection = 'left' | 'right' | 'top' | 'bottom' | 'random';

export function createLightLeakTransition(
  host: HTMLElement,
  options: LightLeakTransitionOptions,
): LightLeakTransitionHandle;
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `from` | `string \| HTMLImageElement \| HTMLVideoElement` | required | Outgoing media. Existing elements are copied rather than moved out of the caller's layout. |
| `to` | `string \| HTMLImageElement \| HTMLVideoElement` | required | Incoming media beneath the outgoing shot. |
| `renderer` | `'auto' \| 'webgl' \| 'css'` | `'auto'` | `auto` takes WebGL2 when it is available and falls back to the CSS/SVG renderer otherwise. Force either path for testing. |
| `style` | `'flash' \| 'sweep'` | `'flash'` | Chooses the overexposure cut or the subtler multi-band sweep. |
| `direction` | `'left' \| 'right' \| 'top' \| 'bottom' \| 'random'` | `'left'` | Edge the leak enters from. `random` resolves deterministically from `seed`. |
| `scroll` | `ScrollProgressOptions \| false` | `{ start: 0, end: 1 }` | Scroll mapping. Pass `false` for manual progress. |
| `progress` | `number` | `0` | Starting progress when `scroll` is `false`. Values are clamped to 0..1. |
| `intensity` | `number` | `0.85` | Overall leak strength, 0..1. |
| `bloom` | `number` | `0.7` | Peak blowout, 0..1. At 1, the flash style approaches white. |
| `warmth` | `number` | `0.5` | Leak colour, from deep red at 0 to pale amber at 1. |
| `softness` | `number` | `80` | Gradient-edge blur in CSS pixels. |
| `organic` | `number` | `0.4` | Turbulence displacement on the leak edge, 0..1. |
| `halation` | `number` | `0.45` | Amber bleed derived from the outgoing shot's brightest areas, 0..1. |
| `grain` | `number` | `0.3` | Overlay-blended film grain, 0..1. |
| `seed` | `number` | `1` | Seed for random direction, sweep geometry, turbulence, flicker, and grain offsets. |

### Handle

```ts
interface LightLeakTransitionHandle extends Effect<LightLeakTransitionOptions> {
  setProgress(progress: number): void;
  readonly activeRenderer: 'webgl' | 'css';
}
```

`setOptions(patch)` merges a partial patch and re-renders in place, including live changes between `flash` and `sweep`, and between renderers. `setProgress(progress)` drives the transition directly and clamps to 0..1; use it with `scroll: false`. `activeRenderer` reports which renderer actually took the job, which is not always the one requested: `auto` and `webgl` both fall back to `css` when `createQuadRenderer` cannot get a WebGL2 context, with a warning. `destroy()` is idempotent in both renderers and releases the GPU program and textures, the injected stack, the SVG filters, scroll and motion listeners, the animation subscription, and media playback.

## The two renderers

Both renderers stage the transition from the same numbers — the same progress curves, the same seeded sweep geometry, the same flicker and drift — so they place the leak identically and differ only in how the pixels are produced.

The **CSS/SVG renderer** is the floor and works without a GPU. The media are cover-fitted layers with the incoming shot beneath the outgoing one, large radial and linear gradients form the leak, `screen` provides the body and `color-dodge` the hottest core, one `feTurbulence`/`feDisplacementMap` filter irregularizes the edge, and a second filter thresholds outgoing luminance, tints those highlights amber and blurs them into halation.

The **WebGL renderer** computes all of that per pixel in one pass: both shots as cover-fitted textures, the gradient stops evaluated in closed form, the same `screen` and `color-dodge` formulas, a tap-ring halation bleed, and film grain. It is the faster path, and by a wide margin wherever the compositor rather than the arithmetic is the bottleneck: the CSS renderer asks for two wide blurs and a stack of blend layers over a box inset to 190% of the frame on every frame, which Blink caches well, WebKit adequately, and Gecko largely not at all.

Measured over a scroll scrub at 1280x800 on an M3 Max, median and 95th-percentile milliseconds per animation frame:

| Engine | CSS/SVG | WebGL |
| --- | --- | --- |
| Chromium | 8.3 / 10.1 | 8.3 / 9.6 |
| Firefox | 100 / 342 | 8.3 / 9.4 |
| WebKit | 16 / 33 | 17 / 19 |

8.3 ms is that display's own frame interval, so the WebGL path is free in Blink and Gecko and within one frame of free in WebKit. The shader is also the consistent one: the same frame drawn in all three engines lands within 7/255 of Chromium's WebGL output, against up to 111/255 through CSS.

Because the shader generates every pixel itself, it does not get the browser's image scaler: a source much larger than the frame is sampled bilinearly and can alias on high-contrast edges where `object-fit: cover` would not. Prefer `renderer: 'css'` when that matters more than frame cost.

Grain changes in discrete seeded steps rather than sliding. Reduced-motion mode stops grain stepping, flare flicker, autonomous drift, and video playback in both renderers, holding the frame they were last drawn at, while scroll progress keeps responding. The effect watches for preference changes at runtime.

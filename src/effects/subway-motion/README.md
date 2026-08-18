# Subway Motion

A drop-in night-train treatment for live DOM, images, and video. It does not render a train scene or replace the host content. CSS layers add darkness, passing light, reflection, and foreground motion above whatever is already in the host.

Two perspectives share the same factory:

- **`window`** puts the content behind a rounded carriage window. Three depth bands travel at different rates — deep tunnel haze, the tunnel lamp line, and a fast near wall — a station wash swells and sweeps through at intervals, and the carriage interior is faintly reflected in the glass. Rain distortion is optional.
- **`platform`** sweeps a five-carriage train across the foreground. A solid body with a roofline, a window band at a fixed height, door openings taller than the windows, a sill and a dark skirt, plus inter-carriage gaps where the host content flashes through before the next carriage occludes it again.

The effect uses CSS transforms, gradients, masks, and blend modes. The optional rain treatment adds one SVG `feTurbulence`/`feDisplacementMap` filter. It uses no Canvas, WebGL, or runtime dependency.

## Usage

Import the stylesheet and create the effect over an existing host:

```ts
import './effects/subway-motion/effect.css';
import { createSubwayMotion } from './effects/subway-motion';

const host = document.querySelector<HTMLElement>('.hero');
if (host === null) throw new Error('Missing .hero');

const effect = createSubwayMotion(host, {
  perspective: 'window',
  intensity: 0.8,
  rain: 0.2,
});

// Options merge into the current configuration.
effect.setOptions({ perspective: 'platform', speed: 1.4 });

// Safe to call more than once.
effect.destroy();
```

`createSubwayMotion` promotes a statically positioned host to a positioning context through the shared `createLayer` helper. Injected layers ignore pointer input and are hidden from assistive technology. Caller-owned content remains in the DOM and keeps its semantics.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `perspective` | `'window' \| 'platform'` | `'window'` | View from inside the carriage or from the platform. Can switch in place with `setOptions`. |
| `speed` | `number` | `1` | Travel rate. `1` runs at line speed — roughly one host width of tunnel or one carriage per second — and also sets how far the lights smear. `0` holds the current frame. |
| `intensity` | `number` | `0.8` | Overall treatment strength, clamped to `0..1`. |
| `darkness` | `number` | `0.55` | Strength of the night grade or train body, clamped to `0..1`. |
| `lights` | `number` | `0.5` | Density and brightness of passing lights, clamped to `0..1`. Changing it rebuilds the seeded gradient, not the DOM. |
| `lightColor` | `string` | `'#ffd27a'` | CSS colour used for tunnel lights and warm window highlights. |
| `reflection` | `number` | `0.4` | Warm interior reflection, clamped to `0..1`; used by `window` only. |
| `rain` | `number` | `0` | Rain streak visibility and SVG displacement strength, clamped to `0..1`; used by `window` only. |
| `flashes` | `number` | `0.35` | Strength of the sweeping station wash on `window`, and of the train's headlight spill on `platform`. Clamped to `0..1`. |
| `rumble` | `number` | `0.3` | Track-joint shake, clamped to `0..1`. Shakes the whole view on `window` and only the train on `platform`. Frequency follows `speed`. |
| `scroll` | `ScrollProgressOptions` | `undefined` | When present, maps travel to scroll progress instead of elapsed time. |
| `seed` | `number` | `1` | Deterministic light rhythm. The same seed and density produce the same strips, station positions, and platform pass phase. |

## Scroll-driven travel

Passing `scroll` disables clock-driven travel and subscribes through the shared scroll runtime:

```ts
const effect = createSubwayMotion(host, {
  scroll: { start: 1, end: 0 },
});

// Manual progress is available on scroll-configured instances.
effect.setProgress(0.6);
```

`setProgress` clamps its input to `0..1`. The active scroll subscription may update it again on the next scroll or resize event.

## Motion and performance

Long light strips and the train move with `transform`; their background geometry stays fixed, so travel never animates `background-position`. Each strip is one element carrying a repeating seeded gradient, not a collection of light nodes: `window` uses three, `platform` uses two. Motion smear is a trailing feather baked into those gradients through a `--subway-motion-tail` custom property that `speed` drives, so a faster setting elongates the lights instead of only repeating them sooner. The effect does not use `backdrop-filter`. Only the platform floor smear carries a CSS blur; every other soft edge is a gradient ramp, and each strip's box is cropped to the band its mask keeps, so no layer pays to blur or composite host height it does not use.

Three authoring rules keep the per-frame cost flat in Gecko, which — unlike Blink and WebKit — re-rasterises this stage's layers on every frame the effect animates rather than caching them. Vertical ramps are written at `179.99deg` instead of `180deg`, because an exactly vertical linear gradient takes a CPU path there that costs roughly 5ms per full-host layer, and a hundredth of a degree off vertical does not. Any ramp on a box wider than the host is tiled at one host width, so that hundredth of a degree cannot accumulate into a visible tilt across five carriages. The aperture's wall, ring, and inner falloff are an `outline`, a `border`, and gradient ramps rather than the `box-shadow` layers they replace, since Gecko re-rasterises rounded-rect shadows on the same terms. Together these take the demo page's median frame in Firefox from 66.7ms to 16.7ms with no frame over 20ms, measured on an M3 Max at 1280x800 with two instances on the page, and leave Chromium at 8.3ms and WebKit at 17ms unchanged.

If you restyle this effect, those rules are worth keeping. One consequence is a floor: outlines follow `border-radius` from Safari 16.4, Chrome 94, and Firefox 88, so an older Safari draws the carriage wall's aperture with square corners rather than rounded ones.

Clock-driven animation subscribes to the shared `onTick` loop only while the host is visible. With reduced motion enabled, autonomous travel, rumble, and light strobing stop on a composed frame — `window` holds a station pulling in, `platform` parks the leading carriage in the right of the frame — and the host content stays readable in both. A scroll-driven instance continues to respond because scroll progress is direct manipulation.

Rain distortion is an enhancement on the visible glass streak layer. Safari can calculate SVG filter bounds for HTML elements differently; the CSS night grade, lights, reflection, and rain streaks still communicate the treatment if displacement is clipped or has no visible effect.

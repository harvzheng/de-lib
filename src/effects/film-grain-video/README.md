# Filmstock Video Background

Take any live video and run it as Kodak Gold 200 shot on 35mm through a projector: a decimated 16 fps frame hold, independent dye-layer curves, amber highlight halation, heavy moving grain, gate weave, exposure flutter, vignette, dust and scratches.

It ships two renderers behind one option. **WebGL** resolves the whole look in a single fragment pass over one video texture: dye cross-talk and the three characteristic curves, a thresholded amber bleed, the grain field, gate weave, vignette, dust and every projector artefact. **Canvas 2D plus SVG filters and CSS** is the floor that needs no GPU: Canvas samples and holds the video frame, `feComponentTransfer` and `feColorMatrix` carry the stock curves and dye-layer cross-talk, and CSS blend modes composite the halation, the weighted turbulence grain and the print wear. `renderer: 'auto'` — the default — takes WebGL when WebGL2 is available and the Canvas/SVG path when it is not. Neither path ever calls `getImageData`.

## Usage

```ts
import './effect.css';
import { createFilmGrainVideo } from './index';

const film = createFilmGrainVideo(background, {
  src: '/media/footage.mp4',
  poster: '/media/poster.jpg',
  fps: 16,
  look: 'kodak-gold-200',
});

film.setOptions({ grain: 1.1, speed: 0.8 });
await film.setSource('/media/another-shot.mp4');

film.destroy();
```

The host supplies the box. Whichever renderer is active, its drawing surface follows the host's content box at the current device-pixel ratio, capped at 2, and the video is cover-fitted so it crops instead of stretching.

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `src` | `string \| HTMLVideoElement` | required | Video URL or an existing video element. |
| `renderer` | `'auto' \| 'webgl' \| 'css'` | `'auto'` | `'auto'` prefers WebGL and falls back to Canvas/SVG when WebGL2 is unavailable. |
| `poster` | `string` | none | Image visible behind the transparent canvas until a video frame is ready. It remains visible if loading fails. |
| `fps` | `number` | `16` | Held-frame sampling rate. The video can play at 30 or 60 fps; the picture only redraws this many times per second. |
| `speed` | `number` | `1` | Assigns `video.playbackRate`. Values below 1 exaggerate the projector judder. |
| `grain` | `number` | `0.85` | Grain strength from 0 to 2. Zero disables the grain layer. |
| `grainSize` | `number` | `1.6` | Grain size in CSS pixels. |
| `halation` | `number` | `0.5` | Amber-red highlight bleed from 0 to 1. Zero disables the halation layer. |
| `gateWeave` | `number` | `0.4` | Stepped gate drift and occasional mechanical jump from 0 to 1. |
| `vignette` | `number` | `0.45` | Edge-darkening strength from 0 to 1. |
| `flicker` | `number` | `0.2` | Exposure variation per held frame from 0 to 1, and the master switch for brightness instability: `flicker: 0` turns flicker off outright, including the projector flashes, whatever `flickerStyle` and `flash` are set to. The shutter band and colour breathing are not brightness flicker and keep their own amounts. |
| `flickerStyle` | `'exposure' \| 'projector' \| 'mixed'` | `'exposure'` | Selects exposure instability, projector artefacts with low resting exposure jitter, or a restrained combination of both. |
| `flickerRate` | `number` | `1.2` | Average projector flash events per second. |
| `flash` | `number` | `0.35` | Strength of rare bright and dark full-frame projector flashes from 0 to 1. |
| `shutterBand` | `number` | `0.3` | Strength of the soft rolling horizontal exposure band from 0 to 1. |
| `colorBreathing` | `number` | `0.25` | Strength of the slow warm/cool white-balance drift from 0 to 1. |
| `dust` | `number` | `0.3` | Speck and vertical-scratch density from 0 to 1. |
| `look` | `'kodak-gold-200' \| 'neutral'` | `'kodak-gold-200'` | Kodak's warm toe, green-leaning mid-tones and yellow shoulder, or a colour-neutral gentle S-curve. |
| `pauseOffscreen` | `boolean` | `true` | Pauses playback and leaves the tick loop while the host is outside the viewport. |

Numeric inputs are constrained to their documented working range by the renderer. The video playback rate is constrained to the range browsers support.

`'exposure'` preserves the original per-held-frame brightness jitter. `'projector'` adds flashes,
the rolling shutter band and colour breathing while reducing that jitter to a low resting level.
`'mixed'` combines the original instability with the projector cues at restrained strengths.

## Handle

`createFilmGrainVideo` returns a `FilmGrainVideoHandle`:

- `setOptions(patch)` merges a partial patch and repaints without rebuilding the effect.
- `setSource(src)` swaps a URL or existing video element in place and resolves when its first frame can be drawn.
- `video` exposes the video element currently being sampled.
- `activeRenderer` is `'webgl'` or `'css'`: which renderer took the job. `renderer: 'webgl'` still reports `'css'` when WebGL2 turned out to be unavailable.
- `destroy()` pauses and releases owned media, removes observers and the shared tick subscription, releases the GPU program and texture or destroys all three SVG filter handles, and detaches the injected layers. It is idempotent.

## Rendering notes

Both renderers sample the video only when a held-frame interval elapses — the WebGL path uploads one texture per held frame, the Canvas path calls `drawImage` — and neither reads pixels back. Halation thresholds luminance before blurring, so dark and mid-tone detail stays sharp. Grain is weighted by frame luminance: mid-tones receive the strongest grain, blown highlights the weakest. The grain field is regenerated per held frame rather than translated continuously.

Animated work runs through the repository's shared `onTick` loop. With `prefers-reduced-motion: reduce`, the video pauses on one graded, grained frame and weave, exposure flicker, projector flashes, the shutter band, colour breathing and grain animation stop. The preference is watched at runtime. Offscreen pausing is independent and can be disabled with `pauseOffscreen: false`.

String URLs are loaded as anonymous CORS media. Same-origin URLs, blob URLs and correctly CORS-enabled remote footage work directly. An existing `HTMLVideoElement` can also be passed when the page owns media setup.

### Which path is faster

WebGL, by a wide margin, wherever the browser has a GPU. Measured on an M3 Max at 1280x800 with the default options, as the median and 95th-percentile cost of one animation frame during steady playback:

| Engine | `renderer: 'css'` | `renderer: 'auto'` (WebGL) |
| --- | --- | --- |
| Chromium | 8.3 / 9.4 ms | 8.3 / 9.9 ms |
| Firefox | 141.5 / 150.3 ms | 8.3 / 9.4 ms |
| WebKit | 38 / 76 ms | 17 / 18 ms |

8.3 ms is that display's refresh floor, so the WebGL column is free in every engine. The Canvas/SVG path is the expensive one because it stacks nine filtered and blended layers, `feTurbulence` covers the whole host on every held frame, and Gecko in particular evaluates filter primitives on the CPU without caching the subtree between frames. Lowering `fps` cuts that work and is also faithful to the effect.

Where WebGL2 exists but runs on a software rasteriser — a GPU-blocklisted browser, `chromium --headless=old`, some VMs — the bleed's 32 texture taps per pixel dominate and a held frame costs around 75 ms. That is still cheaper than the Canvas/SVG path in the same browser (100 ms), but neither is smooth: pass `halation: 0` if you have to support that case, which removes the taps entirely and returns the shader to the refresh floor.

The two renderers agree on the look but not on the exact pixels. With grain switched off, the mean channel difference between them is around 1/255 (99th percentile 8/255) in Chromium and Firefox; the whole difference with grain on is the grain field itself being a different generator — `fbm2` against `feTurbulence` — which measures the same as the effect's own frame-to-frame grain variation. In WebKit the gap is larger, around 6/255, because WebKit's SVG filter chain grades brighter than the tables specify; the WebGL renderer produces the same grade in all three engines.

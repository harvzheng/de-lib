# Particulate Dissolve

Breaks a target into a noisy crumbling edge and loose ash, then drifts it out of the frame. Progress is scrubbed from scroll by default: `0` is completely intact and `1` is completely gone.

The effect ships two renderers behind `createParticulateDissolve`. CSS/SVG plus Canvas 2D is the floor and can dissolve arbitrary live DOM. WebGL is an optional media-only upgrade that keeps the source's pixel colour in each drifting breakup cell.

## Usage

```ts
import './effect.css';
import { createParticulateDissolve } from './index';

const dissolve = createParticulateDissolve(document.querySelector('#target')!, {
  direction: 'up',
  grain: 6,
  seed: 1,
});

// Switch renderer or tune the look without replacing the handle.
dissolve.setOptions({ drift: 0.6, renderer: 'css' });

dissolve.destroy();
```

Omit `src` to dissolve the host's existing text and markup. The CSS renderer wraps those existing nodes while active and restores them when destroyed.

Pass media to enable the WebGL path:

```ts
const dissolve = createParticulateDissolve(host, {
  src: '/media/shot-a.jpg',
  renderer: 'auto',
});

console.log(dissolve.activeRenderer); // 'webgl' or 'css'
```

A media host can contain whatever should be revealed behind the source. At progress `1`, both renderers are fully transparent.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `src` | `string \| HTMLImageElement \| HTMLVideoElement` | omitted | Media to dissolve. When omitted, the CSS renderer dissolves the host's live content. |
| `renderer` | `'auto' \| 'webgl' \| 'css'` | `'auto'` | `auto` prefers WebGL for media and otherwise uses CSS. A forced WebGL request falls back to CSS when media or WebGL2 is unavailable. |
| `scroll` | `ScrollProgressOptions \| false` | `{ start: 0.9, end: 0.35 }` | Maps the host's viewport travel to progress. Pass `false` for manual control. |
| `progress` | `number` | `0` | Initial manual progress when `scroll` is `false`. Values are clamped to `0..1`. |
| `direction` | `'left' \| 'right' \| 'up' \| 'down' \| 'random'` | `'up'` | Direction of the breakup front and ash drift. |
| `drift` | `number` | `0.45` | Travel distance as a fraction of the larger target dimension. |
| `grain` | `number` | `6` | Breakup-cell size in CSS pixels. Smaller values produce finer ash. |
| `edge` | `number` | `0.6` | How far the dissolving body leads particle drift, from `0` to `1`. |
| `flecks` | `number` | `900` | Loose Canvas 2D flecks in the CSS renderer, capped internally at 1400. |
| `color` | `string` | source colour | Optional CSS colour used to tint the detached ash. |
| `turbulence` | `number` | `0.35` | Path variation from `0` to `1`. |
| `seed` | `number` | `1` | Deterministic seed. The same seed and options produce the same breakup. |

## Manual scrubbing and reversibility

```ts
dissolve.setOptions({ scroll: false });
dissolve.setProgress(0.6);
dissolve.setProgress(0.3);
dissolve.setProgress(0.6);
```

Particle geometry is generated from the seed. Position, rotation, scale, and opacity are then calculated directly from particle identity and current progress. No velocity or prior-frame state is integrated, so both visits to `0.6` render the same particle state even after reversing or jumping through the scrub.

## Renderer details

### CSS/SVG + Canvas 2D

One static, seeded `feTurbulence` field is blended with a directional field. Two progress-driven alpha thresholds produce the surviving body and a narrow edge band. The edge band is displaced with `feDisplacementMap` and offset in the selected direction. A bounded Canvas 2D overlay draws detached flecks only when progress, options, or size changes. Flecks are capped at 1400 and device pixel ratio at 2.

This path works over selectable text, links, nested markup, images, and video. Without an explicit `color`, loose DOM flecks inherit the live body's computed text colour; the displaced edge keeps the source's own colour.

### WebGL

Each source pixel belongs to a cell sized from `grain`. The cell identity hashes to a detachment threshold, drift direction, travel scale, and turbulence. Once detached, the fragment samples the source from an analytically offset location, retaining the image or video's colour as it moves.

`createQuadRenderer` can return `null` when WebGL2 is unavailable or shader compilation fails. That outcome falls back to the CSS renderer and leaves the page intact. WebGL is never required.

## Motion and performance

Scroll remains active under `prefers-reduced-motion` because it is direct manipulation. The renderers watch the preference at runtime; video playback and redraw ticks stop when reduced motion is enabled. Still images and live DOM never run a free-running loop.

The SVG turbulence field is not regenerated during scrubbing. A frame changes only threshold and displacement attributes, then redraws the bounded fleck canvas. The WebGL renderer redraws on progress or size changes; video is the only source that needs the shared animation tick.

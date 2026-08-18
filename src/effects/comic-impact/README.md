# Comic Impact

A comic-book impact beat placed behind caller-owned text. The target remains real, selectable, translatable content; the effect contributes one pointer-transparent, assistive-technology-hidden SVG containing a seeded burst, an offset print shadow and radiating speed lines.

```ts
import { createComicImpact } from './effects/comic-impact';
import './effects/comic-impact/effect.css';

const handle = createComicImpact(document.querySelector<HTMLElement>('#pow')!, {
  shape: 'starburst',
  fill: '#ffd23f',
  trigger: 'inview',
  seed: 1,
});

handle.replay();
handle.destroy();
```

## API

```ts
createComicImpact(target: HTMLElement, options?: ComicImpactOptions): ComicImpactHandle
```

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `shape` | `'starburst' \| 'cloud' \| 'jagged' \| 'spike'` | `'starburst'` | Burst silhouette behind the target. |
| `fill` | `string` | `'#ffd23f'` | Burst fill colour. |
| `ink` | `string` | `'#12100e'` | Outline, shadow and speed-line colour. |
| `inkWidth` | `number` | `4` | Burst outline width in pixels. |
| `points` | `number` | `12` | Number of outer points; the polygon alternates outer and inner vertices. |
| `irregularity` | `number` | `0.35` | Seeded hand-inked unevenness from 0 to 1. |
| `speedLines` | `number` | `14` | Radiating line count, clamped to 0–24. |
| `offset` | `number` | `6` | Offset printed shadow in pixels. |
| `pop` | `number` | `0.45` | Entry overshoot from 0 to 1. |
| `shake` | `number` | `3` | Hold-phase shake amplitude in pixels. |
| `rotation` | `number` | `-8` | Rotation of the entire burst in degrees. |
| `trigger` | `'inview' \| 'scroll' \| 'manual'` | `'inview'` | Playback model. |
| `scroll` | `ScrollProgressOptions` | core defaults | Start/end mapping for scroll scrubbing. |
| `duration` | `number` | `900` | In-view timeline duration in milliseconds. |
| `seed` | `number` | `1` | Deterministic geometry seed. |

The returned handle adds:

```ts
handle.setProgress(0.5); // manual/direct progress, clamped to 0..1
handle.replay();         // restart an in-view beat
```

`setOptions(patch)` merges options, rebuilds the owned SVG in place and restarts an in-view beat when the target is visible. `destroy()` is idempotent and removes observers, tick/scroll subscriptions and the one injected layer.

## Triggers and reduced motion

- `inview` plays the pop, brief shake, hold and exit once when the target first enters the viewport. `replay()` starts it again.
- `scroll` maps the complete timeline through the shared `onScrollProgress` runtime.
- `manual` waits for `setProgress()`.

Under `prefers-reduced-motion: reduce`, an in-view impact holds the fully formed burst. Scroll and manual instances keep tracking direct progress, but use a full-size, rotation-only frame with no overshoot or shake. Runtime preference changes are observed without a reload.

## Geometry

`buildBurstGeometry()` in `burst.ts` is DOM-free and deterministic. It uses the pack's `mulberry32` and `seededWave` helpers to perturb alternating outer/inner radii and to place independent speed lines. The same dimensions, options and seed produce byte-identical SVG path data.

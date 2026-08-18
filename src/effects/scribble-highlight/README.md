# Scribble Highlight

A hand-drawn annotation that draws itself around any element, boils frame-by-frame like rough
animation, then flutters away. Pure SVG plus a `feTurbulence`/`feDisplacementMap` pair for the crayon
edge — no canvas, no WebGL, no dependencies.

The effect this reproduces is the one video editors build by hand: screenshot a frame, scribble
roughly around the subject, skip a frame, scribble it again _from scratch_, then stack the drawings
back over the footage. So this does the same thing. `frames` complete drawings are generated
independently — each from its own PRNG stream and its own noise field — and cycled at `fps`. Nothing
is being wobbled; the crawl comes from the drawings genuinely disagreeing with each other. Running at
12 fps against a 60 Hz page is the "on twos" stutter that sells it as hand-made.

Exactly one drawing is in the DOM at any moment.

## Usage

```ts
import { createScribbleHighlight } from './effects/scribble-highlight';
import './effects/scribble-highlight/effect.css';

const claim = document.querySelector<HTMLElement>('#claim')!;

const handle = createScribbleHighlight(claim, {
  variant: 'circle',
  color: 'var(--amber)',
  strokeWidth: 4,
  jitter: 5,
  trigger: 'inview',
  duration: 700,
});

handle.setOptions({ variant: 'underline' });
handle.replay();
handle.destroy();
```

Trace a subject inside a still or a video frame. Points are `0..1` pairs in the target's own box, so
one outline holds at every rendered size:

```ts
createScribbleHighlight(document.querySelector<HTMLElement>('#shot')!, {
  variant: 'trace',
  padding: 0,
  trigger: 'scroll',
  scroll: { start: 0.85, end: 0.5 },
  flutterOut: false,
  path: [
    [0.532, 0.067],
    [0.686, 0.291],
    [0.762, 0.847],
    [0.504, 0.999],
    [0.395, 0.46],
    [0.446, 0.145],
  ],
});
```

## Options

| Option        | Default          | What it does                                                                                                                                                     |
| ------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant`     | `'circle'`       | Base geometry: `'circle'`, `'underline'`, `'box'`, `'strike'`, `'arrow'`, `'star'`, `'trace'`.                                                                    |
| `color`       | `'currentColor'` | Any CSS colour, including `var(--token)`. The default inherits the target's own text colour.                                                                      |
| `strokeWidth` | `3`              | Stroke width in px. Each pass varies it by roughly ±20% so overlapping strokes do not look printed.                                                               |
| `frames`      | `6`              | Independently redrawn drawings cycled to produce the boil. `1` is a still drawing.                                                                                |
| `fps`         | `12`             | Boil rate. 12–15 is the "on twos" range editors use; above ~20 the crawl turns into buzz.                                                                         |
| `jitter`      | `4`              | Roughness of the hand, in px of deviation from the base geometry.                                                                                                 |
| `passes`      | `2`              | Overlapping strokes per drawing. A real hand goes round twice; each pass gets its own start angle, amplitude, bias and width, so passes overlap instead of tracing each other. |
| `padding`     | `10`             | Slack around the target's box, in px. The overlay grows by this on all four sides.                                                                                |
| `seed`        | `1`              | PRNG seed. The same seed always produces the same drawings; it also offsets the boil clock, so two instances on one page do not flicker in lockstep.              |
| `texture`     | `'crayon'`       | `'crayon'` roughens the stroke edge with `feTurbulence` + `feDisplacementMap`, re-seeded on every boil frame so the roughening changes with the drawing. `'clean'` is a plain stroke. |
| `trigger`     | `'inview'`       | `'scroll'` scrubs the timeline by scroll position, `'inview'` plays it once on entry, `'manual'` waits for `setProgress`.                                         |
| `scroll`      | —                | `{ start?, end? }` scroll mapping, used when `trigger` is `'scroll'`. See `src/core/scroll.ts`.                                                                   |
| `duration`    | `700`            | Draw-on duration in ms when `trigger` is `'inview'`. The hold is `1.6×` this and the flutter is `0.9×` this.                                                      |
| `flutterOut`  | `true`           | After the draw-on, strokes break up and flutter away.                                                                                                            |
| `path`        | —                | For `'trace'`: the outline to trace, as points in the target's box space, each `0..1`. Values outside `0..1` are allowed and simply fall outside the box.          |

## Handle

```ts
interface ScribbleHighlightHandle {
  /** Merges a patch over the current options and regenerates the drawings. */
  setOptions(patch: Partial<ScribbleHighlightOptions>): void;
  /** Drives the draw-on manually, 0..1. Only meaningful with trigger 'manual'. */
  setProgress(progress: number): void;
  /** Replays the draw-on from zero. */
  replay(): void;
  /** Removes the SVG, the filter and every listener. Safe to call twice. */
  destroy(): void;
}
```

`setOptions` keeps the current playhead, so changing `color` or `strokeWidth` mid-animation does not
restart the draw-on. Call `replay()` when you want it from the top.

## Timeline

`trigger: 'scroll'` and `trigger: 'manual'` map a single `0..1` progress onto the whole timeline: the
draw-on runs over the first `0.45`, the drawing holds, and the flutter runs from `0.72` to `1`.
Scrubbing backwards reverses all of it. `trigger: 'inview'` runs the same shape off a clock instead,
sized by `duration`.

## Notes

- The overlay is a `pointer-events: none`, `aria-hidden="true"` layer inside the target, so the
  annotated element keeps its own accessible name and stays clickable.
- The overlay is sized by `onResize`, so the drawings regenerate against the target's real box when
  text reflows.
- `prefers-reduced-motion: reduce` stops the boil and the autonomous clock. With `trigger: 'inview'`
  that means one drawing, fully drawn, held still. With `'scroll'` or `'manual'` the draw-on and
  flutter keep following progress, because scrubbing is direct manipulation rather than motion the
  page inflicts on the reader. The preference is re-checked live.
- `trace` with fewer than three `path` points falls back to `circle` geometry rather than rendering
  nothing.
- Every class in `effect.css` is prefixed `scribble-`. The `scribble-demo-*` block at the end of that
  file is layout for `demo.html` only.

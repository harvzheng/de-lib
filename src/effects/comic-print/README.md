# Comic Print

A static newsprint-comic treatment for live DOM, images and video. It combines an SVG posterisation and channel-registration filter with cached CSS halftone and paper-grain layers. No filter parameter animates, so video can keep playing without a full-host effect rebuild on every animation frame.

```ts
import { createComicPrint } from './effects/comic-print';
import './effects/comic-print/effect.css';

const handle = createComicPrint(document.querySelector<HTMLElement>('#panel')!, {
  palette: 'newsprint',
  dotSize: 4,
  levels: 5,
});

handle.setOptions({ palette: 'sunday' });
handle.destroy();
```

## API

```ts
createComicPrint(host: HTMLElement, options?: ComicPrintOptions): ComicPrintHandle
```

When `src` is omitted, the effect treats the host's existing children. A supplied image or video element is moved into the host while the effect is active and returned to its original location on `destroy()`. A string creates an image, or a muted looping inline video when its URL ends in `.mp4`, `.webm`, `.ogv` or `.ogg`.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `src` | `string \| HTMLImageElement \| HTMLVideoElement` | omitted | Optional media to treat instead of the host's existing content. |
| `palette` | `'newsprint' \| 'sunday' \| 'mono' \| 'noir'` | `'newsprint'` | Limited-palette channel mapping. |
| `dotSize` | `number` | `4` | Halftone dot pitch in pixels. |
| `halftone` | `number` | `0.55` | Dot-screen strength from 0 to 1. |
| `screenAngle` | `number` | `15` | Dot-screen rotation in degrees. |
| `levels` | `number` | `5` | Discrete posterisation steps per channel. Values are clamped to 2–16. |
| `misregistration` | `number` | `1.5` | Red/green/blue plate offset in pixels. |
| `grain` | `number` | `0.4` | Static paper-grain strength from 0 to 1. |
| `paper` | `string` | `'#f4ecd8'` | CSS colour used for the paper stock. |
| `roughness` | `number` | `0.3` | Ink-edge displacement from 0 to 1. |
| `contrast` | `number` | `1.15` | Pre-screen contrast from 0 to 2. |

`setOptions(patch)` merges a partial update and re-renders the static filter and texture settings. Passing `{ src: undefined }` returns to the host's original content. `destroy()` is idempotent: it removes both texture layers and the SVG filter, restores moved media and puts the host's original children back in order.

## Rendering and accessibility

The filter uses `feComponentTransfer type="discrete"` for posterisation, a palette `feColorMatrix`, separated and offset colour plates recombined with `feBlend`, and low-amplitude `feTurbulence` displacement for rough ink edges. The halftone and grain are cached CSS texture layers with no timeline.

Generated string media is decorative (`alt=""`), so give the host an accessible name when that media conveys content. Supplied image elements retain their own alternative text. The effect has no autonomous motion, and therefore needs no reduced-motion substitution.

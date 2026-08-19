# Crumpled Paper

Whatever is in the host ends up looking printed on a sheet that was screwed up in a fist and flattened out again: irregular panels tilted at their own angles, creases where they meet, fibre tooth, and dirt left in the folds.

The creases are real shading, not a texture image. There is a surface and a distant light, so the whole sheet *turns* when the light angle moves — and with `lightShift` set, it turns as the reader scrolls.

## Implementation

Two renderers behind one factory, selected with `renderer` and reported back as `activeRenderer`.

**WebGL** is the one that convinces, and what it buys is specific enough to justify the GPU. The sheet is evaluated per pixel as a **max of cones**: every cell of a jittered grid owns a site with its own height, slope and stretch axis, and the sheet's height is the highest cone over the pixel. The maximum of such functions is a power diagram — irregular panels meeting along creases — which is what a crumpled sheet geometrically *is*. Three octaves give big panels with finer crumple laid across them, and the joins use a **smooth** maximum: a hard `max` flips the normal over one pixel, and lighting a discontinuity draws a 1px scratch, where real paper has a fillet because the fibres cannot take a zero-radius bend. Normals are finite differences of that field at float precision, then Lambert plus a deliberately broad specular.

The canvas composites with straight alpha and **no blend mode**: the shader paints toward the shadow colour where the sheet turns away, toward the paper's lit tone where it faces the light, and paints nothing where the sheet is flat. Two consequences worth knowing — the diffuse side is absorptive (it darkens the print), while the sheen is additive, which is why the creases stay visible over dark ink rather than disappearing into it; and nothing depends on how an engine isolates a stacking context.

**CSS/SVG** is the floor. Canvas 2D bakes the crease field (`creases.ts`, needle creases plus broad swells) into a height map once — one radial gradient per shape, summed in `lighter` — and `feDiffuseLighting` shades that map live, so moving the light re-lights the same sheet without re-baking it. It gives up precision rather than structure: the map travels the filter pipeline as 8-bit alpha, which caps the relief it can carry before the folds band, and its panels are drawn as overlapping ellipses rather than solved.

Nothing in either path is per-frame. The map or the quad is redrawn only when an option changes, or when scroll moves the light.

### What was tried first, and why each failed

Recorded because each one is a dead end you would otherwise walk into:

- **`feTurbulence` as the height field** — stucco at every frequency. Turbulence has no straight anything, and paper creases along lines.
- **Quantising the field into flat facets** (`feComponentTransfer type="discrete"`) — flat facets share one normal, so only their boundaries shade and the sheet reads as a contour map.
- **Mixing a fine paper-tooth field into the height map** — diffuse shading follows the field's *gradient* between adjacent pixels, so a 3px tooth shades roughly seventy times harder than a 220px fold. Even a few per cent of it turns the sheet into leather and hides every crease. Tooth belongs on its own layer, which is what `grain` is.
- **Creases as full-width gradient bands** — each one ends at the sheet edge with a hard mitre, and a sheet full of those reads as shattered glass.
- **A hard `max` of cones** — creases came out as 1px scratches. The smooth maximum above is the fix.
- **One lattice for every octave** — the cone grid read straight through the shading as a faint plaid, which is worse than noise for being the only regular thing in the picture. Fixed by three things together: a domain warp of nearly a cell before the lattice is sampled, a per-octave rotation, and an octave ratio (0.37) that is deliberately not a power of two, since octaves an octave apart share harmonics and the shared ones are exactly the cell edges.
- **Tinting the crease shadow with the paper stock** — a fold occludes light, and occluded light is dark, not beige. Mixing the stock colour into the shadow at any real strength is what made the creases read as mid-brown smudges. The shadow is now near-black, only faintly warmed, and the dark side of the shading is curved and gained so a crease bottoms out faster than it lights up.

Two GLSL traps also cost time and are worth repeating: a backtick anywhere inside a shader template string terminates the literal (`src/core/glsl.ts` warns about this), and `flat` is a reserved interpolation qualifier in GLSL ES 3.00, so it cannot name a variable.

## Usage

```ts
import './effects/crumpled-paper/effect.css';
import { createCrumpledPaper } from './effects/crumpled-paper';

const paper = createCrumpledPaper(host, {
  renderer: 'auto',
  scale: 240,
  depth: 0.6,
  creases: 0.65,
  light: 135,
});

paper.activeRenderer; // 'webgl' or 'css'

// Let the sheet catch the light as the reader scrolls.
paper.setOptions({ lightShift: 60 });

// Later — on unmount, route change, or teardown.
paper.destroy();
```

`host` is any element: a block of live text, a figure, a whole section. Its content stays exactly where it was and stays selectable; the sheet is appended inside it, `aria-hidden`, and never takes pointer events.

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `renderer` | `'auto' \| 'webgl' \| 'css'` | `'auto'` | `'auto'` prefers WebGL and falls back to the Canvas 2D + SVG renderer when WebGL2 is unavailable. |
| `scale` | `number` | `240` | Px across a panel — how hard the sheet was crumpled. Panel counts follow the host's area divided by this, so the same value reads the same on a thumbnail and on a full-bleed section. |
| `depth` | `number` | `0.6` | Crease depth, 0..1. Drives both the lighting relief and how much of the shading lands. |
| `creases` | `number` | `0.65` | 0..1 — how much of the structure is sharp creases rather than broad soft panels. Low is a sheet that was folded; high is one that was balled up. |
| `light` | `number` | `135` | Direction the light comes from, in degrees clockwise from the left. |
| `shine` | `number` | `0.3` | Specular sheen along the creases, 0..1. |
| `paperColor` | `string` | `'#f2ece0'` | Paper stock the content is toned toward. |
| `tone` | `number` | `0.35` | How far the content is toned toward `paperColor`, 0..1. |
| `grain` | `number` | `0.4` | Fibre grain, 0..1. This is the sheet's tooth; it is deliberately not part of the height map. |
| `soiling` | `number` | `0.4` | Darkening in the deep folds, 0..1. |
| `warp` | `number` | `2` | Px the host's own content is dragged along the creases. `0` leaves the host's `filter` untouched. |
| `lightShift` | `number` | `0` | Degrees the light swings across the scroll range. `0` means no scroll subscription at all. |
| `scroll` | `ScrollProgressOptions \| false` | `{ start: 1, end: 0 }` | The scroll mapping used by `lightShift` (see `src/core/scroll.ts`). |
| `seed` | `number` | `1` | PRNG seed. Same seed, same sheet. |

## Notes and limits

- **`warp` writes `filter` on the host element.** That is the only way to reach the host's own pixels from an overlay. The warp is appended to whatever the host already had rather than replacing it — CSS filter lists apply left to right, so the host's own filter runs first and the warp displaces its result — and the original value is captured at construction and restored by `destroy()`. Be aware that a CSS filter makes the host a containing block and its own stacking context. Set `warp: 0` if that matters.
- **The warp field is turbulence, not the baked map.** `feDisplacementMap` needs its map as a filter input, and pulling the baked map in would mean `feImage`, whose data-URL support is the least even thing in the filter spec. At a couple of px the difference is invisible; past about 6px it is not, which is why `warp` stays small.
- **The CSS renderer's height map is a PNG data URL**, baked at CSS px with the long side capped at 1400. It carries shading, not detail, so it is never baked at device pixels. The WebGL renderer draws at 1x device pixels for the same reason.
- **`shine` does more work than it looks like.** The sheen is the additive part of the sheet, so it is what keeps creases readable over dark ink. Turning it to 0 over a dark photograph leaves very little.

## Accessibility and reduced motion

The stack is `aria-hidden="true"` and `pointer-events: none`; the host's own content keeps its accessible name and stays selectable.

By default this effect has **no animation at all** — it is a standing treatment, and there is nothing on a clock to stop. With `lightShift` set, the light angle is scroll-scrubbed, which is direct manipulation by the reader rather than autonomous motion, so `prefers-reduced-motion: reduce` correctly leaves it responding to scroll.

Without WebGL2, `createQuadRenderer` returns `null`, the factory logs and builds the CSS renderer instead, and `activeRenderer` reports `'css'`. That path is Canvas 2D plus SVG filters, so it runs identically with or without a GPU.

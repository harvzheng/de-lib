# Wiggly Text

Type that wobbles like a hand redrawing the same line: a few times a second the
outline is redrawn slightly differently, so it never sits still. Works on any
font, any size, any script, and the text underneath stays real text.

## Why it is font- and text-agnostic

Nothing in this effect measures a glyph, splits a string, wraps characters in
`<span>`s, or asks the font for anything. It displaces the pixels the host has
already painted, which means it applies equally to a variable-weight headline, an
italic serif, a monospace timestamp, a numeral, an emoji, an icon-font ligature,
Devanagari, and a `<sup>` in the middle of a line — all of which the demo page
shows running from one shared set of options.

That also means the content is untouched: selectable, searchable, translatable,
copy-pasteable, and read by a screen reader exactly as it was. A button inside a
wiggling host still takes clicks, because a CSS `filter` does not intercept
pointer events.

The alternative — splitting text into per-character elements and animating each —
needs to know where characters are, breaks selection and copy-paste, defeats
ligatures and shaping (fatal for Arabic and Devanagari), and cannot handle a
string it did not create. This does none of that.

## Implementation

`feTurbulence` generates a displacement field; `feDisplacementMap` moves the
host's own pixels through it. The boil is a **short cycle** of fields — three
drawings by default, swapped 8 times a second — because that is what reads as a
human redrawing a line. A fresh random field every step reads as television
static, so the cycle is deliberately short and repeating, and the seeds within it
are spread apart because neighbouring `feTurbulence` seeds look alike.

Three decisions are load-bearing:

- **`type="fractalNoise"`, not `"turbulence"`.** Turbulence sums absolute-value
  octaves, which creases the field, and a crease in a displacement field is a
  corner in a letter's outline. At headline sizes that reads as torn paper rather
  than as a drawn line.
- **The wavelength is long relative to a stroke.** A field that varies faster
  than the stem width chatters each stem's two edges independently, which reads
  as a shredded photocopy. At the default 90px the whole letter bends.
- **The edge is reconstructed after displacement.** `feDisplacementMap` fetches
  its source per device pixel with no filtering, so displacing an antialiased
  edge by a fractional amount aliases it — clearly visible at a device pixel
  ratio of 1, and invisible at 2, which is how it was diagnosed. About a pixel of
  blur followed by a steepened alpha ramp rebuilds a smooth edge. The ramp is
  centred on alpha 0.5 (`intercept = (1 - slope) / 2`), which is where the eye
  reads an edge, so the reconstruction sharpens the outline without moving it or
  changing the apparent font weight.

Per frame this writes exactly one attribute — the turbulence seed — and only when
the frame of the cycle actually changed. Nothing accumulates: the same seed
always produces the same drawing.

## Usage

```js
import { createWigglyText } from './effects/wiggly-text';

const wiggle = createWigglyText(document.querySelector('h1'), {
  amplitude: 2,
  boil: 8,
});

wiggle.setOptions({ boil: 0 }); // hold one drawing
wiggle.destroy();
```

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `amplitude` | `number` | `2` | Peak excursion in px. **Not** a fraction of the font size: a value that is lively on a 64px headline is a broken printer on 15px body copy. Past roughly a tenth of the font size, thin stems tear. |
| `wavelength` | `number` | `90` | Px between wobbles. Long bends whole words; short chatters stroke edges. Below about 3× the stem width it reads as damage rather than as drawing. |
| `roughness` | `number` | `0.35` | 0..1 fine chatter riding on the main wobble, as 1–4 turbulence octaves. |
| `boil` | `number` | `8` | Redraws per second. `0` holds a single wiggled drawing, which is a legitimate static look, not "off". |
| `frames` | `number` | `3` | Drawings in the repeating cycle, capped at 12. Three is the hand-drawn-animation convention; more reads as noise. |
| `crisp` | `number` | `0.7` | 0..1 edge reconstruction. Set `0` for a host whose content is deliberately soft-edged — a glow, a drop shadow, a feathered PNG — since steepening alpha hardens those too. |
| `seed` | `number` | `1` | Same seed, same wiggle. |

`handle.frame` reports which drawing of the cycle is on screen. It exists for the
demo readout, not for the look.

## Notes and limits

**A filtered element is a containing block and a stacking context.** That is a
property of CSS `filter` rather than of this effect, but it is the one way
dropping this onto an existing layout can move something: absolutely-positioned
descendants will resolve against the wiggling host. Wiggle an inner element, or
pin those descendants to a different ancestor.

**It composes with a host that is already filtered.** The wiggle is appended to
the host's inline `filter` rather than replacing it, so a `blur(2px)` heading
becomes a wiggling blurred heading; CSS filter lists apply left to right, so the
host's own filter runs first and the wiggle displaces its result. The original
value is captured at construction and restored on `destroy()`, and an inline
`none` is dropped rather than listed, since `none url(#id)` is invalid and would
silently discard the whole declaration.

**Amplitude is in px on purpose.** A ratio of the font size sounds friendlier but
is wrong: a mixed host (the demo has one) has several font sizes under one
filter, and a field cannot displace each of them by a different amount.

## Accessibility and reduced motion

The text is never replaced, duplicated or hidden, so its accessible name, reading
order and selection behaviour are exactly as authored, and it takes pointer
events normally.

With `prefers-reduced-motion: reduce` the boil stops and one wiggled drawing is
held — the treatment stays, the motion goes, which is what the preference asks
for. The preference is watched at runtime, so toggling it in system settings
takes effect without a reload.

It never uses WebGL2: this is one CSS `filter` value and four SVG filter
primitives, so it runs identically with or without a GPU.

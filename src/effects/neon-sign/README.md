# Neon Sign

Your own heading, wired to the mains: a bent glass tube that glows, buzzes,
occasionally stutters out and relights, and throws a pool of light onto whatever
it is sitting on. Works on any font, any string, and the text stays real text.

## Why it is font- and text-agnostic

Nothing here measures a glyph, splits a string, wraps a character in a `<span>`,
or copies the text into a second element. The tube *is* the host's text: the
effect writes a `color` and a `text-shadow` stack on the host and lets the text
engine shape the glow, which is why a heavy sans, an italic serif, a tracked-out
monospace in small caps, and a line that changes font mid-sentence all light the
same way from one shared set of options — as the demo page shows.

The content is therefore untouched: selectable, searchable, translatable,
copy-pasteable, and read by a screen reader exactly as authored. The demo has a
live `getSelection()` readout so you can confirm that from the page rather than
taking this paragraph's word for it.

The alternative — a duplicate copy of the text behind the real one to carry the
glow — is the usual way this look is built, and it puts the same sentence into the
accessibility tree twice, breaks selection across it, and desynchronises the
moment the text changes. There is no second copy here.

## Implementation

**The glow is a `text-shadow` stack, not a filter on the host, and that is a
constraint rather than a preference.** A CSS `filter` makes its element an
isolation group, and the ambient spill is an injected child that has to blend
with the page *behind* the sign — a bloom filter on the host would light nothing
but the host's own box. `text-shadow` is also the only glyph-shaped blur that can
be applied to text without touching the text.

**The core is not the same colour as the halo.** One gas colour becomes four in
`tube.ts`: a near-white core (the gas over-exposed toward white, because the
centre of a real tube is blown out), the gas itself for the halo, a deepened gas
colour for the light in the air, and a near-white tint for light bouncing off a
surface. Lighting core and halo with one colour is the classic mistake — it reads
as a coloured drop shadow, not as something emitting light. The tightest copy in
the stack is core-coloured and the wide ones are not, which is what puts a hot
centre inside a saturated halo.

**The spill is two layers, because a light source and a lit surface composite
differently.** Haze in the air can only add light, which is `screen`, and
`screen` is a no-op against white. Light bounced off a surface can only attenuate
what that surface was already reflecting, which is `multiply`, and `multiply` is a
no-op against black. A sign on a dark photograph is carried by the first, a sign
on white paper by the second, and neither layer needs to know which it landed on.
The bounce layer is a ring rather than a disc: close to the glass the eye reads
the tube's own halo, and holding the multiply peak off centre keeps it off the
letters, which it would otherwise dull.

**The pool's unevenness is gradients, not a filter, and that was a performance
decision.** A real pool of light on a real surface is not a perfect ellipse, and
the honest way to express that is an SVG chain — `feTurbulence` →
`feDisplacementMap` → `feGaussianBlur` — warping the gradient. That is what this
effect shipped first, and it was far too expensive: a full-bleed filter per spill
layer, ten of them on the demo page, re-run on every flicker step. Measured on a
3-second window, p95 frame time was **56ms in WebKit and 28ms in Chromium with 16
dropped frames**, against **17ms and 9ms with the chain removed** — and a 2×
display gives the filter four times the pixels to chew.

What replaced it is three offset ellipses per layer at different sizes and alphas.
Three overlapping gradients do not sum to an ellipse: the union has a lopsided
edge, which is the read we wanted, for a gradient fill instead of a filter pass.
The effect now uses no SVG at all.

**Every per-frame write goes on the outer layer, never the inner one.** The spill
is a pair of elements per layer: the outer carries the blend mode and the flicker's
opacity, the inner carries the gradients. Gecko and WebKit re-rasterise a filtered
or blurred element whenever a property on *that* element changes, so an opacity
write on a layer that also carries a filter re-runs the filter. This is the third
time that trap has cost this pack time (see `ripped-page` and `light-leak-transition`),
and splitting the elements is the fix. The outer layers are promoted with
`will-change: opacity` only while the flicker is actually running: ten permanently
promoted full-bleed layers is video memory spent on a sign that is holding still.

**The flicker is a schedule, not a sine.** Real failing neon has a fast
low-amplitude buzz that never stops, plus occasional dropouts where the tube snaps
dark, the starter tries once to three times, and the gas fills back in. Both live
in `tubeBrightness(elapsed, { flicker, seed })`:

- The buzz is two incommensurate lattices of smooth value noise at about 17 Hz.
  Mains hum is 100–120 Hz, far past what a display can show, so 17 Hz is the
  slowest ripple that still reads as electrical rather than as a pulse. It only
  ever darkens, so the tube never overshoots its own full output.
- Dropouts are scheduled per fixed slot of time, which is what makes them
  stochastic *and* stateless: a slot's event is a pure function of its index and
  the seed, so brightness can be asked for at any time, in any order, and the
  sequence is identical. Frequency rises with the square of `flicker`, so a low
  setting is genuinely rare rather than merely less frequent.
- A dropout bottoms out at an afterglow rather than at black, and the final
  relight is a ramp: striking is fast, filling is not.

Per step this writes four properties — the host's `color` and `text-shadow`, and
one `opacity` on each spill layer — at 20 steps a second rather than 60, and only
when the brightness has moved to a different one of 64 rungs. The buzz spends most
of its time inside a band a few percent wide, so most steps write nothing at all.
That matters here more than in most effects: every write repaints four blurred
copies of the host's text.

## Usage

```js
import { createNeonSign } from './effects/neon-sign';

const sign = createNeonSign(document.querySelector('h1'), {
  color: '#ff2e63',
  glowRadius: 18,
  spill: 0.55,
  flicker: 0.3,
});

sign.setOptions({ lit: false }); // cold grey glass, no glow
sign.destroy();
```

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | `string` | `'#ff2e63'` | The gas colour, as hex or `rgb()`. Four colours are derived from it, so it is parsed in JS: colour keywords and `oklch()` need a document to resolve and fall back to the default rather than throwing. |
| `coreHeat` | `number` | `0.78` | 0..1 how far the tube's core is over-exposed toward white. `0` makes core and halo the same colour, which is the drop-shadow look; `1` is a white-hot core. |
| `glowRadius` | `number` | `18` | Outer glow radius in px. The stack's widest copy reaches about twice this. In px, not ems, because one host can hold several font sizes under one glow. |
| `intensity` | `number` | `0.85` | 0..1 glow strength, scaling the whole stack. `0` keeps the lit core colour on the text and paints no halo at all — a tube behind frosted glass. |
| `spill` | `number` | `0.55` | 0..1 light thrown onto the surroundings. `0` stops both spill layers painting, so the sign glows without lighting the page. |
| `spillRadius` | `number` | `140` | How far in px the pool reaches past the host's box. |
| `flicker` | `number` | `0.3` | 0..1 buzz depth and dropout frequency. `0` is a healthy tube: brightness is exactly 1, forever. `1` is a sign someone should have replaced. |
| `lit` | `boolean` | `true` | `false` is cold grey glass with no glow and no spill — a sign that is off, which is not the same thing as an effect that is off. |
| `seed` | `number` | `1` | Same seed, same failures, in the same order. |

`handle.brightness` reports the tube's current 0..1 output. It exists for the
demo readout, not for the look.

## Notes and limits

**The pool of light is centred on the host's box, not on the text inside it.**
Measuring where the text actually is would mean measuring text, which is the one
thing this effect refuses to do. For a block-level host wider than its line, the
consequence is a pool wider than the sign: give the host `width: fit-content`, or
hang the sign off an inline-block. The demo does the former, and says so in its
stylesheet.

**The host's `color` is written, so the host's own colour is overridden** while
the effect is live (and restored on `destroy()`). A descendant with its own
`color` — a link, a `<code>` — keeps that colour and still gets the glow, since
`text-shadow` inherits and the descendant's colour does not come from the host.
That is usually what you want; if it is not, light the descendant separately.

**Blending needs the host not to be isolated.** The spill layers blend with
whatever is painted behind the host, which works because the effect adds only
`position: relative` to it. A host that already has `opacity`, `filter`,
`transform`, `will-change`, `isolation` or `backdrop-filter` on it is a stacking
context that isolates its own blending, and the spill will then light only the
host's own background. Move the effect to an inner element in that case.

**It never writes `host.style.filter`.** A pre-existing inline filter on the host
survives untouched, which is not true of most effects in this pack.

## Accessibility and reduced motion

The text is never replaced, duplicated or hidden, so its accessible name, reading
order and selection behaviour are exactly as authored. Both injected layers are
`aria-hidden="true"` and `pointer-events: none`, so nothing in the sign can be
selected, focused, announced or clicked by accident.

With `prefers-reduced-motion: reduce` the sign stays **lit and glowing** and stops
buzzing: the treatment is the look, the flicker is the motion, and only the motion
goes. The same held frame is used when the host scrolls off-screen and when
`flicker: 0` is set. The preference is watched at runtime, so toggling it in
system settings takes effect without a reload. `lit: false` is the only thing that
puts the sign out.

One honest caveat: a dropout briefly dims the letters toward grey glass, which is
a brief contrast drop on the text itself. It lasts a few hundred milliseconds at
most, it never happens under reduced motion, and `flicker: 0` removes it entirely.

It never uses WebGL2, SVG or canvas: this is a `text-shadow` stack over two
blend-mode layers of CSS gradients, so it runs identically with or without a GPU.

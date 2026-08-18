/**
 * The filter side of the filmstock look: a per-channel Kodak Gold 200 grade,
 * a highlight-thresholded halation bleed, and a mid-tone-weighted grain field.
 *
 * The tables are the grade. `feComponentTransfer type="table"` is read here as
 * the characteristic curve of one dye layer, and the `feColorMatrix` ahead of it
 * is the inter-image effect between layers — light exposing the green-sensitive
 * layer also fogs its neighbours, which is the part of a film stock that a
 * saturation or hue tweak cannot reproduce.
 *
 * `color-interpolation-filters="sRGB"` is mandatory on all three: the linearRGB
 * default would feed these hand-tuned tables linear values, putting the toe and
 * the shoulder at the wrong densities.
 *
 * Every region is clamped to the element box (`x="0" width="100%"`) instead of
 * the -10%/120% default. A drop-in background must not paint outside its host,
 * and both the halation blur and the turbulence field would.
 *
 * These strings are the single definition of the look. The WebGL renderer reads
 * the same ones as uniforms through `tableSamples`, `colorMatrix3` and
 * `curveSamples`, so the two renderers cannot drift apart.
 */

import { clamp01 } from '../../core/math';

export type FilmstockLook = 'kodak-gold-200' | 'neutral';

export interface LookGrade {
  /** `feColorMatrix` values: cross-talk between the three dye layers. */
  crossTalk: string;
  /** Nine `tableValues` samples across input 0..1, one set per channel. */
  red: string;
  green: string;
  blue: string;
}

export const GRADE_FILTER = `
  <filter filterUnits="objectBoundingBox" x="0" y="0" width="100%" height="100%"
          color-interpolation-filters="sRGB">
    <feColorMatrix data-p="cross-talk" type="matrix" result="dye"
      values="1 0 0 0 0
              0 1 0 0 0
              0 0 1 0 0
              0 0 0 1 0" />
    <feComponentTransfer in="dye">
      <feFuncR data-p="curve-r" type="table" tableValues="0 1" />
      <feFuncG data-p="curve-g" type="table" tableValues="0 1" />
      <feFuncB data-p="curve-b" type="table" tableValues="0 1" />
    </feComponentTransfer>
  </filter>
`;

/** Inter-image amber: what the red-sensitive layer scatters back into its neighbours. */
export const HALATION_AMBER = `1.00 0.20 0.08 0 0
              0.22 0.42 0.04 0 0
              0.04 0.04 0.18 0 0
              0    0    0    1 0`;

/**
 * Halation is the red-sensitive layer scattering light back through the base,
 * so only the highlights contribute. `luminanceToAlpha` collapses the frame to
 * a luminance mask, the discrete `feFuncA` cuts everything under the threshold
 * to zero, and `feComposite operator="in"` keeps the original colour of what
 * survives — so the blur that follows only ever sees bright pixels.
 */
export const HALATION_FILTER = `
  <filter filterUnits="objectBoundingBox" x="0" y="0" width="100%" height="100%"
          color-interpolation-filters="sRGB">
    <feColorMatrix type="luminanceToAlpha" result="luma" />
    <feComponentTransfer in="luma" result="mask">
      <feFuncA data-p="threshold" type="discrete" tableValues="0 0 0 0 0 0 0.5 1" />
    </feComponentTransfer>
    <feComposite in="SourceGraphic" in2="mask" operator="in" result="highlights" />
    <feColorMatrix in="highlights" type="matrix" result="amber" values="${HALATION_AMBER}" />
    <feGaussianBlur data-p="bleed" in="amber" stdDeviation="10" />
  </filter>
`;

/**
 * Grain amplitude against frame luminance, as `feFuncA` table samples: mid-tones
 * grain hardest, blown highlights have no silver left to modulate.
 */
export const GRAIN_WEIGHT = '0.45 0.85 1 0.9 0.5 0.12';

/**
 * Grain, weighted by the frame it sits on. The source graphic is a copy of the
 * held frame purely so the weighting has something to read: `luminanceToAlpha`
 * plus a table turns the picture into a grain-amplitude field, and the final
 * `feComposite operator="in"` stamps that field into the noise layer's alpha.
 * Blown highlights come out almost clean and the mid-tones grain hardest, which
 * is where silver-halide grain actually lives.
 *
 * Two octaves, not three: the field is re-evaluated over the whole box on every
 * held frame, and turbulence is the most expensive primitive in the chain.
 */
export const GRAIN_FILTER = `
  <filter filterUnits="objectBoundingBox" x="0" y="0" width="100%" height="100%"
          color-interpolation-filters="sRGB">
    <feTurbulence data-p="noise" type="fractalNoise" baseFrequency="0.625" numOctaves="2"
                  seed="1" stitchTiles="stitch" result="noise" />
    <feColorMatrix data-p="amplitude" in="noise" type="matrix" result="silver"
      values="0.5 0 0 0 0.25
              0.5 0 0 0 0.25
              0.5 0 0 0 0.25
              0   0 0 0 1" />
    <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="luma" />
    <feComponentTransfer in="luma" result="weight">
      <feFuncA data-p="weight" type="table" tableValues="${GRAIN_WEIGHT}" />
    </feComponentTransfer>
    <feComposite in="silver" in2="weight" operator="in" />
  </filter>
`;

/** Samples in every channel curve; `type="table"` spreads them evenly over 0..1. */
export const CURVE_SAMPLES = 9;

/**
 * Kodak Gold 200: warm-yellow highlight roll-off (blue shoulders hardest), a
 * green-leaning mid-tone, warm magenta in the shadows where red sits above blue
 * above green, and a toe that lifts all three off zero so blacks read milky
 * rather than crushed. The mid-section of every curve is steeper than linear and
 * both ends are flatter, which is the gentle S.
 */
export const LOOKS: Record<FilmstockLook, LookGrade> = {
  'kodak-gold-200': {
    crossTalk: `0.920 0.070 0.010 0 0
                0.035 0.925 0.040 0 0
                0.020 0.110 0.870 0 0
                0     0     0     1 0`,
    red: '0.070 0.150 0.258 0.378 0.508 0.645 0.770 0.878 0.968',
    green: '0.048 0.130 0.244 0.372 0.516 0.652 0.768 0.862 0.942',
    blue: '0.062 0.140 0.240 0.352 0.480 0.600 0.706 0.800 0.878',
  },
  neutral: {
    crossTalk: `1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 1 0`,
    red: '0.030 0.118 0.232 0.360 0.500 0.640 0.768 0.882 0.970',
    green: '0.030 0.118 0.232 0.360 0.500 0.640 0.768 0.882 0.970',
    blue: '0.030 0.118 0.232 0.360 0.500 0.640 0.768 0.882 0.970',
  },
};

/** Bands in the halation threshold table; `type="discrete"` splits 0..1 evenly. */
export const HALATION_BANDS = 8;
/** Luminance the threshold sits at when halation is dialled to zero. */
const HALATION_CEILING = 0.86;
const HALATION_REACH = 0.32;
/** Luminance the mask takes to ramp from clear to opaque. */
export const HALATION_SOFTNESS = 0.16;

/** Luminance the mask's edge sits at; walks down the range as `amount` rises. */
export function halationEdge(amount: number): number {
  return HALATION_CEILING - clamp01(amount) * HALATION_REACH;
}

/**
 * Bleed radius in CSS px: a floor, plus a share of the shorter box edge so the
 * glow stays the same fraction of the frame at any size.
 */
export function halationSigma(amount: number, width: number, height: number): number {
  return 3 + Math.min(width, height) * 0.012 * amount;
}

/**
 * A steep but not binary threshold: one band of ramp keeps the mask from
 * banding visibly once it is blurred. Raising `amount` walks the edge down the
 * luminance range so more of the frame is recruited into the bleed.
 */
export function halationThreshold(amount: number): string {
  const edge = halationEdge(amount);
  const bands: string[] = [];
  for (let i = 0; i < HALATION_BANDS; i += 1) {
    const centre = (i + 0.5) / HALATION_BANDS;
    bands.push(clamp01((centre - edge) / HALATION_SOFTNESS).toFixed(3));
  }
  return bands.join(' ');
}

/**
 * Rebuilds the noise layer as a grey field centred on 0.5 — the neutral value
 * for an `overlay` blend — with `amplitude` as its contrast. Only the red
 * channel of the turbulence is used, and alpha is forced to 1 so the following
 * composite is the single thing that decides where grain lands.
 */
export function grainMatrix(amplitude: number): string {
  const gain = amplitude.toFixed(4);
  const offset = (0.5 - amplitude * 0.5).toFixed(4);
  return (
    `${gain} 0 0 0 ${offset} ` +
    `${gain} 0 0 0 ${offset} ` +
    `${gain} 0 0 0 ${offset} ` +
    `0 0 0 0 1`
  );
}

/** Whitespace-separated SVG attribute values, as numbers. */
export function tableSamples(values: string): number[] {
  return values.trim().split(/\s+/).map(Number);
}

/**
 * The RGB block of a 4x5 `feColorMatrix`, transposed into the column-major order
 * `uniformMatrix3fv` reads: SVG lists rows, GL takes columns.
 */
export function colorMatrix3(values: string): Float32Array {
  const numbers = tableSamples(values);
  const columns = new Float32Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      columns[column * 3 + row] = numbers[row * 5 + column];
    }
  }
  return columns;
}

/** The three channel curves interleaved as one vec3 sample per input step. */
export function curveSamples(look: LookGrade): Float32Array {
  const red = tableSamples(look.red);
  const green = tableSamples(look.green);
  const blue = tableSamples(look.blue);
  const samples = new Float32Array(CURVE_SAMPLES * 3);
  for (let i = 0; i < CURVE_SAMPLES; i += 1) {
    samples[i * 3] = red[i];
    samples[i * 3 + 1] = green[i];
    samples[i * 3 + 2] = blue[i];
  }
  return samples;
}

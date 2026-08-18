/**
 * Fragment body for the WebGL filmstock renderer. One pass over one video
 * texture lands where the Canvas/SVG stack's six blended layers land: grade,
 * halation, grain, shutter band, breathing and flash, vignette, dust.
 *
 * `createQuadRenderer` prepends the version, the precisions, `vUv` and
 * `fragColor`, so none of those appear here. Every value that also exists on the
 * CSS side is injected from `grade.ts` and `frame.ts` or named after the
 * `effect.css` rule it has to agree with, because a look split across two
 * renderers only stays one look while there is one copy of its numbers.
 */

import { GLSL_COLOR, GLSL_HASH, GLSL_NOISE } from '../../core/glsl';
import { DUST_SPECKS, DUST_VIEWBOX } from './frame';
import { CURVE_SAMPLES, GRAIN_WEIGHT, HALATION_BANDS, tableSamples } from './grade';

const GRAIN_WEIGHT_SAMPLES = tableSamples(GRAIN_WEIGHT);

const FILMSTOCK_BODY = /* glsl */ `
uniform sampler2D uVideo;
uniform vec2 uResolution;
uniform float uDpr;
uniform vec2 uVideoSize;
uniform vec3 uCurve[${CURVE_SAMPLES}];
uniform mat3 uCrossTalk;
uniform mat3 uAmber;
uniform float uExposure;
/* Gate drift: x and y in CSS px, then rotation in radians. */
uniform vec3 uWeave;
uniform float uHalation;
/* Threshold edge and ramp width, in luminance. */
uniform vec2 uHalationCut;
/* Bleed radius: the CSS renderer's feGaussianBlur stdDeviation, in CSS px. */
uniform float uHalationSigma;
/* Grain amplitude, then cell size in CSS px. */
uniform vec2 uGrain;
/* Where this held frame reads the grain field; the CSS side re-seeds instead. */
uniform vec2 uGrainOffset;
uniform float uVignette;
/* Rolling shutter band: opacity, top edge and height in CSS px. */
uniform vec3 uBand;
uniform vec2 uBreathing;
/* Flash opacity, and 1 when the flash is a bright one. */
uniform vec2 uFlash;
/* x, y, radius, opacity per speck, in dust viewBox units. */
uniform vec4 uSpecks[${DUST_SPECKS}];
uniform int uSpeckCount;
uniform vec4 uScratch;
uniform float uScratchOpacity;

/* Matches .filmstock-gate's scale() in effect.css: the overscan weave hides in. */
const float GATE_OVERSCAN = 1.04;
const float DUST_VIEWBOX = ${DUST_VIEWBOX}.0;
const float CURVE_STEPS = ${CURVE_SAMPLES - 1}.0;
const int CURVE_LAST = ${CURVE_SAMPLES - 1};
const float HALATION_BANDS = ${HALATION_BANDS}.0;
const float GRAIN_STEPS = ${GRAIN_WEIGHT_SAMPLES.length - 1}.0;
const int GRAIN_LAST = ${GRAIN_WEIGHT_SAMPLES.length - 1};
const float GRAIN_WEIGHT[${GRAIN_WEIGHT_SAMPLES.length}] = float[${GRAIN_WEIGHT_SAMPLES.length}](${GRAIN_WEIGHT_SAMPLES.map((value) => value.toFixed(3)).join(', ')});

/*
 * Taps across the bleed, and how far out they reach in multiples of sigma. A
 * thresholded highlight is a small part of the frame, so the kernel only has to
 * be smooth where it lands, not exact out into the tails.
 */
const int HALATION_TAPS = 32;
const float HALATION_REACH = 2.4;
const float GOLDEN_ANGLE = 2.39996323;

/* The colours the CSS layers are painted in, from effect.css. */
const vec3 SPECK_LIGHT = vec3(0.9686, 0.9098, 0.7804);
const vec3 SPECK_DARK = vec3(0.1529, 0.0784, 0.0549);
const vec3 SCRATCH_TINT = vec3(1.0, 0.8941, 0.6941);
const vec3 BAND_TINT = vec3(0.0196, 0.0275, 0.0392);
const vec3 BREATHE_WARM = vec3(0.9529, 0.6588, 0.3569);
const vec3 BREATHE_COOL = vec3(0.4706, 0.6627, 0.8275);
const vec3 FLASH_BRIGHT = vec3(1.0, 0.9137, 0.7412);
const vec3 FLASH_DARK = vec3(0.0706, 0.0392, 0.0314);

/* Vignette stops, premultiplied: rgb is colour * alpha, w is alpha. */
const vec4 VIGNETTE_NEAR = vec4(vec3(28.0, 10.0, 4.0) / 255.0 * 0.10, 0.10);
const vec4 VIGNETTE_MID = vec4(vec3(12.0, 5.0, 3.0) / 255.0 * 0.53, 0.53);
const vec4 VIGNETTE_FAR = vec4(vec3(5.0, 2.0, 1.0) / 255.0 * 0.92, 0.92);

/* Matches CSS object-fit: cover, so a 16:9 source in a 21:9 host crops. */
vec2 coverUv(vec2 uv, vec2 src, vec2 dst) {
  float srcAspect = src.x / max(src.y, 1.0);
  float dstAspect = dst.x / max(dst.y, 1.0);
  vec2 crop = srcAspect > dstAspect
    ? vec2(dstAspect / srcAspect, 1.0)
    : vec2(1.0, srcAspect / dstAspect);
  return (uv - 0.5) * crop + 0.5;
}

/* feComponentTransfer type="table": one characteristic curve per dye layer. */
vec3 tone(vec3 dye) {
  vec3 s = dye * CURVE_STEPS;
  vec3 low = floor(s);
  vec3 f = s - low;
  ivec3 k = ivec3(low);
  ivec3 next = min(k + 1, CURVE_LAST);
  return vec3(
    mix(uCurve[k.r].r, uCurve[next.r].r, f.r),
    mix(uCurve[k.g].g, uCurve[next.g].g, f.g),
    mix(uCurve[k.b].b, uCurve[next.b].b, f.b));
}

/*
 * The CSS renderer thresholds through a type="discrete" table, which quantises
 * luminance into bands. Quantising here too keeps the two masks identical
 * instead of merely similar.
 */
float highlightMask(vec3 colour) {
  float band = min(floor(luma(colour) * HALATION_BANDS), HALATION_BANDS - 1.0);
  return clamp(((band + 0.5) / HALATION_BANDS - uHalationCut.x) / uHalationCut.y, 0.0, 1.0);
}

/* feFuncA type="table" on frame luminance: how much silver this tone carries. */
float grainWeight(float tone) {
  float s = clamp(tone, 0.0, 1.0) * GRAIN_STEPS;
  int k = int(floor(s));
  return mix(GRAIN_WEIGHT[k], GRAIN_WEIGHT[min(k + 1, GRAIN_LAST)], s - float(k));
}

/* mix-blend-mode: overlay. */
vec3 overlayBlend(vec3 b, vec3 s) {
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
}

/* mix-blend-mode: soft-light, on the compositing spec's D(Cb). */
vec3 softLightBlend(vec3 b, vec3 s) {
  vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
  return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
}

/* The band's gradient: clear, 8%, 56%, 8%, clear, in one colour throughout. */
float bandProfile(float t) {
  if (t <= 0.0 || t >= 1.0) return 0.0;
  if (t < 0.2) return 0.08 * t / 0.2;
  if (t < 0.5) return mix(0.08, 0.56, (t - 0.2) / 0.3);
  if (t < 0.8) return mix(0.56, 0.08, (t - 0.5) / 0.3);
  return mix(0.08, 0.0, (t - 0.8) / 0.2);
}

/*
 * The vignette layer in multiply. Interpolating the stops premultiplied — which
 * is what CSS gradients do — collapses the whole composite into one factor.
 */
vec3 vignetteFactor(vec2 uv, float amount) {
  if (amount <= 0.0) return vec3(1.0);
  // A farthest-corner ellipse centred in its box puts the 100% radius at
  // 1/sqrt(2) of the corner, so the corner lands at exactly 1.0.
  float r = length(uv - 0.5) * 1.4142136;
  vec4 stop;
  if (r < 0.62) stop = mix(vec4(0.0), VIGNETTE_NEAR, clamp((r - 0.39) / 0.23, 0.0, 1.0));
  else if (r < 0.84) stop = mix(VIGNETTE_NEAR, VIGNETTE_MID, (r - 0.62) / 0.22);
  else stop = mix(VIGNETTE_MID, VIGNETTE_FAR, clamp((r - 0.84) / 0.28, 0.0, 1.0));
  return vec3(1.0) - amount * stop.a + amount * stop.rgb;
}

/* The dust SVG, in its own square viewBox with y downward. Premultiplied. */
vec4 dustLayer(vec2 uv) {
  vec2 p = vec2(uv.x, 1.0 - uv.y) * DUST_VIEWBOX;
  // preserveAspectRatio="none": the viewBox stretches to the host box, so a
  // device pixel spans a different number of units on each axis.
  vec2 pixel = DUST_VIEWBOX / uResolution;
  float pixelRadius = 0.5 * length(pixel);
  vec4 layer = vec4(0.0);

  for (int i = 0; i < ${DUST_SPECKS}; i++) {
    if (i >= uSpeckCount) break;
    vec4 speck = uSpecks[i];
    float feather = pixelRadius / speck.z;
    float edge = length((p - speck.xy) / speck.z);
    float alpha = (1.0 - smoothstep(1.0 - feather, 1.0 + feather, edge)) * speck.w;
    // Every third speck is a dark fleck: .filmstock-dust-speck:nth-child(3n).
    vec3 tint = i % 3 == 2 ? SPECK_DARK : SPECK_LIGHT;
    layer = vec4(tint, 1.0) * alpha + layer * (1.0 - alpha);
  }

  if (uScratchOpacity > 0.0) {
    // The rect carries filter: blur(0.35px); half a device pixel is antialiasing.
    vec2 feather = (0.35 * uDpr + 0.5) * pixel;
    vec2 low = uScratch.xy;
    vec2 high = uScratch.xy + uScratch.zw;
    vec2 inside = smoothstep(low - feather, low + feather, p)
      * (1.0 - smoothstep(high - feather, high + feather, p));
    float alpha = inside.x * inside.y * uScratchOpacity;
    layer = vec4(SCRATCH_TINT, 1.0) * alpha + layer * (1.0 - alpha);
  }
  return layer;
}

void main() {
  vec2 cssSize = uResolution / max(uDpr, 0.001);

  // Gate weave, inverted: the CSS renderer transforms the gate layer, so the
  // picture, the bleed and the grain field travel together while the vignette,
  // the flicker layers and the dust above them stay put. CSS y grows downward
  // and its rotate() runs clockwise; both flip against vUv.
  vec2 fromCentre = (vUv - 0.5) * cssSize - vec2(uWeave.x, -uWeave.y);
  float spin = cos(uWeave.z);
  float tilt = sin(uWeave.z);
  vec2 gatePx = vec2(
    fromCentre.x * spin - fromCentre.y * tilt,
    fromCentre.x * tilt + fromCentre.y * spin) / GATE_OVERSCAN;
  vec2 gateUv = gatePx / cssSize + 0.5;

  vec3 picture = texture(uVideo, coverUv(gateUv, uVideoSize, uResolution)).rgb;
  // Cross-talk, then the curves, then the held frame's exposure. Clamped at each
  // step because the SVG filter chain the tables were tuned against clamps too.
  vec3 colour = clamp(tone(clamp(uCrossTalk * picture, 0.0, 1.0)) * uExposure, 0.0, 1.0);

  if (uHalation > 0.0) {
    vec2 sigma = uHalationSigma * uDpr / uResolution;
    vec3 bleed = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < HALATION_TAPS; i++) {
      float index = float(i) + 0.5;
      // Equal-area radii: every tap stands for the same slice of the disc, so
      // the Gaussian weights alone shape the falloff.
      float radius = sqrt(index / float(HALATION_TAPS)) * HALATION_REACH;
      float angle = index * GOLDEN_ANGLE;
      vec2 tap = gateUv + vec2(cos(angle), sin(angle)) * radius * sigma;
      vec3 tapped = texture(uVideo, coverUv(tap, uVideoSize, uResolution)).rgb;
      float weight = exp(-0.5 * radius * radius);
      // Amber before the blur, and masked by the tap's own luminance: the bleed
      // is red-layer scatter, so only highlights are allowed to contribute.
      bleed += weight * clamp(uAmber * tapped, 0.0, 1.0) * highlightMask(tapped);
      total += weight;
    }
    // Screen against a premultiplied source: the mask is already in the bleed.
    vec3 glow = clamp(uHalation * uExposure * bleed / total, 0.0, 1.0);
    colour += glow - colour * glow;
  }

  if (uGrain.x > 0.0) {
    // Two octaves of value noise rather than the shared per-cell grain hash:
    // the CSS field is a smooth feTurbulence, and white noise reads as sensor
    // noise instead of silver.
    float field = fbm2(gatePx / uGrain.y + uGrainOffset, 2);
    vec3 silver = vec3(clamp(0.5 + uGrain.x * (field - 0.5), 0.0, 1.0));
    colour = mix(colour, overlayBlend(colour, silver), grainWeight(luma(picture)));
  }

  if (uBand.x > 0.0) {
    float depth = (1.0 - vUv.y) * cssSize.y;
    float alpha = bandProfile((depth - uBand.y) / max(uBand.z, 1.0)) * uBand.x;
    colour *= mix(vec3(1.0), BAND_TINT, alpha);
  }

  // A flat wash, not a hue-preserving colour blend: the CSS renderer paints these
  // tints on pseudo-elements inside their own layer, which is an isolated group,
  // so its mix-blend-mode: color never sees the frame. All three engines agree,
  // and this matches what the CSS renderer actually composites today.
  colour = mix(colour, BREATHE_WARM, uBreathing.x);
  colour = mix(colour, BREATHE_COOL, uBreathing.y);

  if (uFlash.x > 0.0) {
    bool bright = uFlash.y > 0.5;
    vec3 tint = bright ? FLASH_BRIGHT : FLASH_DARK;
    vec3 flashed = bright ? colour + tint - colour * tint : colour * tint;
    colour = mix(colour, flashed, uFlash.x);
  }

  colour *= vignetteFactor(vUv, uVignette);

  vec4 dust = dustLayer(vUv);
  if (dust.a > 0.0) colour = mix(colour, softLightBlend(colour, dust.rgb / dust.a), dust.a);

  // bayerDither returns an unsigned 0..1 threshold, so centre it before scaling
  // to one 8-bit step; the grade and the vignette both band without it.
  colour += (bayerDither(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

export const FILMSTOCK_FRAGMENT_SOURCE = GLSL_HASH + GLSL_NOISE + GLSL_COLOR + FILMSTOCK_BODY;

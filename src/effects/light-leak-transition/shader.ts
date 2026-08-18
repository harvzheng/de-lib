/**
 * Fragment body for the WebGL leak renderer, composed onto the shared GLSL
 * chunks. `createQuadRenderer` prepends the version, the precisions, `vUv` and
 * `fragColor`, so none of those appear here.
 *
 * Everything the CSS renderer stacks as blurred gradient layers is evaluated
 * here in closed form. Two things keep the two renderers reading as one effect:
 * the gradient stops are premultiplied, so a soft edge fades out instead of
 * darkening, and `screenLayer`/`dodgeLayer` are the CSS compositing formulas
 * rather than an additive approximation. The layer blurs are a real tap-weighted
 * convolution of that field — widening the ramps instead would spread light over
 * a growing area and wash the frame.
 */

import { GLSL_COLOR, GLSL_GRAIN, GLSL_HASH } from '../../core/glsl';

const LEAK_BODY = /* glsl */ `
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uResolution;
uniform float uDpr;
uniform vec2 uFromSize;
uniform vec2 uToSize;
/** Percent of the leak box, on screen axes with y downward. */
uniform vec2 uLeakOffset;
/** cos, sin of the leak rotation. */
uniform vec2 uLeakRot;
/** Autonomous drift of the leak body, in CSS px. */
uniform vec2 uDrift;
/** Per band: x%, y%, cos, sin. */
uniform vec4 uBandXform[3];
/** Per band: scale, half width as a fraction of the band box. */
uniform vec2 uBandShape[3];
uniform vec3 uRed;
uniform vec3 uAmber;
uniform vec3 uMagenta;
uniform float uLeakScale;
uniform float uFromOpacity;
uniform float uExposure;
uniform float uLeakOpacity;
uniform float uCoreOpacity;
uniform float uHalationOpacity;
/** Luminance the halation mask starts opening at. */
uniform float uHalationEdge;
/** Halation bleed radius, in CSS px. */
uniform float uHalationRadius;
uniform float uGrain;
/** Gradient-edge blur, in CSS px. */
uniform float uSoftness;
uniform float uOrganic;
/** 1 for the sweep style, 0 for flash. */
uniform float uSweep;
uniform float uSeed;
uniform float uTime;

/**
 * The bleed is a soft, low-frequency glow at a radius of a few tens of pixels,
 * so six taps carry it; every extra tap is another full-frame texture fetch.
 */
const int HALATION_TAPS = 6;

/**
 * The leak layer carries inset: -45% over createLayer's inline width and height
 * of 100%, and a specified size wins over the right and bottom insets, so the
 * box keeps the frame's size and only its centre moves — up and left by 45% of
 * the frame. Both renderers place the leak the same way because of it.
 */
const float LEAK_SHIFT = -0.45;
/** Each sweep band is inset -18% inside the leak box. */
const float BAND_BOX = 1.36;
/** The flash core is inset 12% inside the leak box. */
const float CORE_BOX = 0.76;

/** Golden angle: the tap rings below cover a disc evenly at any tap count. */
const float TAP_ANGLE = 2.39996323;

/** Matches CSS object-fit: cover — the crop factor to apply around uv 0.5. */
vec2 coverCrop(vec2 src, vec2 dst) {
  float srcAspect = src.x / max(src.y, 1.0);
  float dstAspect = dst.x / max(dst.y, 1.0);
  return srcAspect > dstAspect
    ? vec2(dstAspect / srcAspect, 1.0)
    : vec2(1.0, srcAspect / dstAspect);
}

/**
 * Inverse of a CSS translate/rotate/scale list, which is what maps a screen
 * point into the coordinates a gradient inside that element is authored in.
 */
vec2 untransform(vec2 p, vec2 offset, vec2 rot, float scale) {
  vec2 q = p - offset;
  return vec2(q.x * rot.x + q.y * rot.y, q.y * rot.x - q.x * rot.y) / scale;
}

/** One tap of a Gaussian disc of radius 2 sigma, as an offset scaled by sigma. */
vec2 tapOffset(int index, int count, float sigma) {
  float r = sqrt((float(index) + 0.5) / float(count));
  float angle = float(index) * TAP_ANGLE;
  return vec2(cos(angle), sin(angle)) * (r * 2.0 * sigma);
}

/** Weight for tapOffset at the same index: the Gaussian at that radius. */
float tapWeight(int index, int count) {
  return exp(-2.0 * (float(index) + 0.5) / float(count));
}

/**
 * Two channels of value noise off one lattice, which is what feTurbulence hands
 * feDisplacementMap in its R and G channels. Half the hashing of two fbm2 calls,
 * and a displacement field only has to be smooth.
 */
vec2 vnoise22(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 a = hash22(cell);
  vec2 b = hash22(cell + vec2(1.0, 0.0));
  vec2 c = hash22(cell + vec2(0.0, 1.0));
  vec2 d = hash22(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** Three octaves, matching the CSS renderer's feTurbulence numOctaves. */
vec2 fbm22(vec2 p) {
  vec2 sum = vec2(0.0);
  float amplitude = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 3; i++) {
    sum += amplitude * vnoise22(p);
    norm += amplitude;
    p *= 2.0;
    amplitude *= 0.5;
  }
  return sum / norm;
}

vec3 unpremul(vec4 c) {
  return c.rgb / max(c.a, 1e-4);
}

/** CSS blend compositing, premultiplied in and out; blended is B(Cb, Cs). */
vec4 composite(vec4 dst, vec4 src, vec3 blended) {
  return vec4(
    (1.0 - dst.a) * src.rgb + src.a * dst.a * blended + (1.0 - src.a) * dst.rgb,
    src.a + dst.a * (1.0 - src.a));
}

vec4 screenLayer(vec4 dst, vec4 src) {
  vec3 b = unpremul(dst);
  vec3 s = unpremul(src);
  return composite(dst, src, b + s - b * s);
}

vec4 dodgeLayer(vec4 dst, vec4 src) {
  vec3 b = unpremul(dst);
  vec3 s = unpremul(src);
  return composite(dst, src, min(b / max(1.0 - s, vec3(1e-4)), vec3(1.0)));
}

/**
 * Ramps a premultiplied gradient toward its next stop between from and to, with
 * sigma of blur folded in. A Gaussian of sigma turns a ramp of width d into one
 * of width sqrt(d^2 + 20 sigma^2) about the same midpoint — smoothstep's
 * variance is d^2/20 — so the light spreads without the interior brightening.
 */
vec4 stopTo(vec4 current, vec4 next, float x, float from, float to, float sigma) {
  float mid = (from + to) * 0.5;
  float spread = 0.5 * sqrt((to - from) * (to - from) + 20.0 * sigma * sigma);
  return mix(current, next, smoothstep(mid - spread, mid + spread, x));
}

/**
 * Blur in the units of a radial gradient's parameter. The conversion depends
 * only on the direction from the gradient's centre, so normalising first keeps
 * it finite at the centre itself, where the colour is flat anyway.
 */
float radialSigma(vec2 q, vec2 radii, float sigma) {
  vec2 u = q / max(length(q), 1e-4);
  return sigma * length(u / (radii * radii)) / max(length(u / radii), 1e-4);
}

/**
 * The blurred version of a background's clip to its element box. A Gaussian's
 * step response over an axis-aligned edge is what CSS blur does to that edge,
 * and smoothstep matches it once their variances agree: smoothstep over width W
 * has variance W squared over 20.
 */
float boxClip(vec2 p, vec2 size, float sigma) {
  vec2 edge = size * 0.5;
  float w = max(4.4721 * sigma, 1e-4);
  vec2 lo = smoothstep(-edge - w * 0.5, -edge + w * 0.5, p);
  vec2 hi = 1.0 - smoothstep(edge - w * 0.5, edge + w * 0.5, p);
  return lo.x * hi.x * lo.y * hi.y;
}

/**
 * The leak layer's own content at leak-local point q, premultiplied: the flash
 * body with its dodged core, or the three sweep bands. box is the leak box in
 * frame-height units; soft carries the two CSS blur radii in the same units,
 * the body and bands in x and the core's 18px-wider one in y.
 *
 * The gradients are already smooth over hundreds of pixels, so the CSS blur only
 * shows where a background is clipped to its element box — the flash body's
 * bottom edge cutting across the frame is part of the look, not an artefact —
 * and that edge is what boxClip blurs.
 */
vec4 leakContent(vec2 q, vec2 box, vec2 soft) {
  if (uSweep > 0.5) {
    vec2 bandBox = box * BAND_BOX;
    float wd = soft.x / bandBox.x;
    vec4 group = vec4(0.0);
    for (int i = 0; i < 3; i++) {
      vec2 bq = untransform(
        q, uBandXform[i].xy * 0.01 * bandBox, uBandXform[i].zw, uBandShape[i].x);
      float d = abs(bq.x) / bandBox.x;
      vec3 tint = i == 0 ? uRed : (i == 1 ? uAmber : uMagenta);
      vec4 band = vec4(mix(tint, vec3(1.0), 0.58), 1.0);
      band = stopTo(band, vec4(tint * 0.73, 0.73), d, 0.0, 0.05, wd);
      band = stopTo(band, vec4(0.0), d, 0.05, uBandShape[i].y, wd);
      band *= boxClip(bq, bandBox, soft.x);
      if (i == 1) group = dodgeLayer(group, band);
      else group = screenLayer(group, band);
    }
    return group;
  }

  vec2 er = vec2(0.32, 0.78) * box;
  float e = length(q / er);
  float we = radialSigma(q, er, soft.x);
  vec4 body = vec4(0.960, 0.937, 0.843, 0.96);
  body = stopTo(body, vec4(uAmber, 1.0), e, 0.0, 0.22, we);
  body = stopTo(body, vec4(uRed, 1.0), e, 0.22, 0.52, we);
  body = stopTo(body, vec4(0.163, 0.0, 0.013, 0.4), e, 0.52, 0.68, we);
  body = stopTo(body, vec4(0.0), e, 0.68, 0.82, we);

  float t = 0.5 + q.x / box.x;
  float wt = soft.x / box.x;
  vec4 bar = vec4(0.0);
  bar = stopTo(bar, vec4(uRed * 0.76, 0.76), t, 0.18, 0.38, wt);
  bar = stopTo(bar, vec4(uAmber * 0.86, 0.86), t, 0.38, 0.52, wt);
  bar = stopTo(bar, vec4(0.0), t, 0.52, 0.82, wt);
  // One background shorthand: the radial paints over the linear.
  vec4 group = vec4(body.rgb + bar.rgb * (1.0 - body.a), body.a + bar.a * (1.0 - body.a));
  group *= boxClip(q, box, soft.x);

  if (uCoreOpacity > 0.0) {
    vec2 cr = vec2(0.68, 0.86) * CORE_BOX * box;
    float ce = length(q / cr);
    float wc = radialSigma(q, cr, soft.y);
    vec4 core = vec4(1.0);
    core = stopTo(core, vec4(1.0, 0.988, 0.941, 1.0) * 0.99, ce, 0.0, 0.35, wc);
    core = stopTo(core, vec4(1.0, 0.961, 0.827, 1.0) * 0.96, ce, 0.35, 0.56, wc);
    core = stopTo(core, vec4(uAmber, 1.0), ce, 0.56, 0.74, wc);
    core = stopTo(core, vec4(0.0), ce, 0.74, 1.0, wc);
    group = dodgeLayer(group, core * (uCoreOpacity * boxClip(q, box * CORE_BOX, soft.y)));
  }
  return group;
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  // One CSS pixel in the frame-height units all the geometry below works in.
  float px = uDpr / max(uResolution.y, 1.0);
  // CSS geometry is authored with y downward and its origin at the frame centre.
  vec2 sp = vec2(vUv.x * aspect, 1.0 - vUv.y) - vec2(aspect, 1.0) * 0.5;
  vec2 box = vec2(aspect, 1.0);
  // The core is blurred 18px wider than the body and the bands.
  vec2 soft = max(uSoftness, 0.0) * px + vec2(0.0, 18.0 * px);

  vec2 fromCrop = coverCrop(uFromSize, uResolution);
  vec3 fromColour = texture(uFrom, (vUv - 0.5) * fromCrop + 0.5).rgb;
  vec3 toColour = texture(uTo, (vUv - 0.5) * coverCrop(uToSize, uResolution) + 0.5).rgb;

  // brightness(1 + 2e) saturate(1 - e) on the outgoing shot, in sRGB, which is
  // where the equivalent CSS filter functions run.
  vec3 lifted = mix(vec3(luma(fromColour)), fromColour, 1.0 - uExposure) * (1.0 + 2.0 * uExposure);
  vec3 colour = mix(toColour, clamp(lifted, 0.0, 1.0), uFromOpacity);

  if (uHalationOpacity > 0.0) {
    // The CSS renderer thresholds luminance, tints the highlights amber and
    // blurs them; a golden-angle tap ring is that blur without the surface.
    vec4 halo = vec4(0.0);
    float total = 0.0;
    for (int i = 0; i < HALATION_TAPS; i++) {
      vec2 offset = tapOffset(i, HALATION_TAPS, uHalationRadius * px);
      float weight = tapWeight(i, HALATION_TAPS);
      vec2 tap = vUv + vec2(offset.x / aspect, offset.y);
      vec3 c = texture(uFrom, (tap - 0.5) * fromCrop + 0.5).rgb;
      float mask = clamp((luma(c) - uHalationEdge) / 0.16, 0.0, 1.0);
      vec3 amber = clamp(vec3(
        dot(c, vec3(1.00, 0.24, 0.08)),
        dot(c, vec3(0.20, 0.46, 0.05)),
        dot(c, vec3(0.03, 0.04, 0.16))), 0.0, 1.0);
      halo += weight * vec4(amber * mask, mask);
      total += weight;
    }
    halo *= uHalationOpacity / total;
    // Premultiplied screen over an opaque backdrop.
    colour = colour + halo.rgb * (1.0 - colour);
  }

  // Outside the leak box, plus what the blur and the displacement can reach past
  // it, every layer's clip is zero, so the noise and the stop chain are skipped.
  vec2 leakReach = box * (uSweep > 0.5 ? BAND_BOX : 1.0) * 0.5
    + 2.3 * max(soft.x, soft.y) + uOrganic * 26.0 * px;
  vec2 q =
    untransform(sp - box * LEAK_SHIFT, uLeakOffset * 0.01 * box, uLeakRot, uLeakScale)
    - uDrift * px;

  if (uLeakOpacity > 0.0 && abs(q.x) < leakReach.x && abs(q.y) < leakReach.y) {
    if (uOrganic > 0.0) {
      // feTurbulence baseFrequency and feDisplacementMap scale are both in
      // user-space pixels, so both convert through px. Displacement runs on the
      // leak layer, after its children have been blurred, so it moves the whole
      // blurred field.
      float freq = (0.006 + uOrganic * 0.018) / px;
      vec2 rough = fbm22(q * freq + uSeed * 13.7);
      q += (rough - 0.5) * (uOrganic * 52.0 * px);
    }

    vec4 group = leakContent(q, box, soft);
    colour = colour + group.rgb * uLeakOpacity * (1.0 - colour);
  }

  if (uGrain > 0.0) {
    // grain's size is in drawing-buffer pixels, so the DPR keeps the cell the
    // same size in CSS pixels as the stylesheet's 160px noise tile.
    float g = grain(vUv, uResolution, uTime, max(1.6 * uDpr, 1.0));
    colour = applyGrain(colour, g, uGrain);
  }

  // bayerDither returns an unsigned threshold, so centre it before scaling to
  // one 8-bit step; gradients this wide band visibly without it.
  colour += (bayerDither(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

export const LEAK_FRAGMENT_SOURCE = GLSL_HASH + GLSL_GRAIN + GLSL_COLOR + LEAK_BODY;

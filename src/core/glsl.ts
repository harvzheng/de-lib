/**
 * Reusable GLSL source chunks, concatenated ahead of an effect's own fragment
 * body. Order matters: later chunks call into earlier ones.
 *
 * These are pasted into the shader ahead of the caller's source, so they must
 * declare no `#version`, no precision qualifiers and no in/out variables —
 * `createQuadRenderer` owns the prelude. Nothing inside these template strings
 * may contain a backtick: it terminates the literal and the build fails far
 * from the real line.
 */

/** hash11, hash12, hash21, hash22 — Hoskins-style integer-free hashes. */
export const GLSL_HASH = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(p.xyx * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash21(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
`;

/** Needs GLSL_HASH. vnoise2, fbm2, ridged2 — all returning 0..1. */
export const GLSL_NOISE = /* glsl */ `
// Upper bound on every octave loop below so the compiler can unroll them;
// the caller's octave count only ends the loop early.
const int NOISE_MAX_OCTAVES = 8;

float vnoise2(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  // Quintic fade: second derivative vanishes at the lattice, so summed octaves
  // show no creases along cell boundaries.
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(cell);
  float b = hash12(cell + vec2(1.0, 0.0));
  float c = hash12(cell + vec2(0.0, 1.0));
  float d = hash12(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(vec2 p, int octaves) {
  float sum = 0.0;
  float norm = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < NOISE_MAX_OCTAVES; i++) {
    if (i >= octaves) break;
    sum += amplitude * vnoise2(p);
    norm += amplitude;
    p *= 2.0;
    amplitude *= 0.5;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

// Creased ridges rather than blobs — the shape burn edges and light leaks want.
float ridged2(vec2 p, int octaves) {
  float sum = 0.0;
  float norm = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < NOISE_MAX_OCTAVES; i++) {
    if (i >= octaves) break;
    float ridge = 1.0 - abs(vnoise2(p) * 2.0 - 1.0);
    sum += amplitude * ridge * ridge;
    norm += amplitude;
    p *= 2.0;
    amplitude *= 0.5;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}
`;

/** Needs GLSL_HASH. grain -> -1..1, plus a tone-weighted application. */
export const GLSL_GRAIN = /* glsl */ `
// Grain resamples once per exposed frame, not once per display frame; anything
// faster reads as digital noise rather than film.
const float GRAIN_FPS = 24.0;

/**
 * The size argument is the grain cell in screen pixels and res the
 * drawing-buffer size, so one call looks the same at any resolution or DPR.
 */
float grain(vec2 uv, vec2 res, float t, float size) {
  vec2 cell = floor(uv * res / max(size, 1.0));
  float frame = floor(t * GRAIN_FPS);
  return hash12(cell + vec2(frame * 17.13, frame * 31.71)) * 2.0 - 1.0;
}

/**
 * Silver density carries grain hardest through the mid-tones: shadows hold less
 * of it and a blown highlight has none left to modulate.
 */
vec3 applyGrain(vec3 colour, float g, float strength) {
  float l = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  float shadowFloor = mix(0.4, 1.0, smoothstep(0.0, 0.2, l));
  float highlightRolloff = 1.0 - 0.9 * smoothstep(0.6, 1.0, l);
  return colour + g * strength * shadowFloor * highlightRolloff;
}
`;

/** luma, sRGB both ways, filmic tonemap, vignette, ordered dither. */
export const GLSL_COLOR = /* glsl */ `
float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 srgbToLinear(vec3 c) {
  vec3 v = max(c, vec3(0.0));
  return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(0.04045, v));
}

vec3 linearToSrgb(vec3 c) {
  vec3 v = max(c, vec3(0.0));
  return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v));
}

// Narkowicz's ACES fit: cheap, and it rolls blown highlights off to white
// instead of clipping them to a hard edge, which is what a burn needs.
vec3 filmicToneMap(vec3 c) {
  vec3 v = max(c, vec3(0.0));
  return clamp((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14), 0.0, 1.0);
}

/** Multiplier, 1.0 at the centre; an amount of 0 disables it. */
float vignette(vec2 uv, float amount) {
  vec2 d = uv - 0.5;
  // Normalised so the corners sit at radius 1.
  float r = length(d) * 1.4142135;
  return mix(1.0, smoothstep(1.05, 0.35, r), amount);
}

/**
 * 4x4 ordered dither in 1/16 steps. Added at roughly 1/255 before the 8-bit
 * write, it breaks the banding that grades and vignettes leave in flat areas.
 */
float bayerDither(vec2 p) {
  const mat4 pattern = mat4(
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0);
  ivec2 cell = ivec2(mod(floor(p), 4.0));
  return pattern[cell.x][cell.y] / 16.0;
}
`;

/**
 * Fragment body for the WebGL bokeh renderer. `createQuadRenderer` prepends the
 * version, the precisions, `vUv` and `fragColor`, so none of those appear here.
 *
 * The disc list is resolved on the CPU (`discs.ts`) and uploaded as uniforms, so
 * this shader and the CSS renderer draw the same layout. What it adds is what
 * only a per-pixel path can do: a real polygonal aperture, a rim that fringes
 * cooler than the core, and overlapping discs that roll off instead of clipping.
 */

import { GLSL_COLOR } from '../../core/glsl';

/** Mirrors MAX_DISCS in `discs.ts`; the arrays are sized once at compile time. */
export const SHADER_MAX_DISCS = 64;

const BOKEH_BODY = /* glsl */ `
uniform vec2 uResolution;
/** x, y in height units with the GL origin; z radius in height units; w brightness. */
uniform vec4 uDiscs[${SHADER_MAX_DISCS}];
uniform vec3 uDiscTints[${SHADER_MAX_DISCS}];
uniform int uDiscCount;
uniform float uSoftness;
uniform float uRim;
uniform float uBlades;

const float TAU = 6.28318530718;

/**
 * Folds the angle into one blade sector, so the level set at 1.0 is a regular
 * polygon inscribed in the round radius. Below three blades the aperture is
 * open round and the fold is skipped entirely.
 */
float apertureRadius(vec2 offset, float radius) {
  float d = length(offset);
  if (uBlades < 3.0) return d / radius;
  float sector = TAU / uBlades;
  float folded = mod(atan(offset.y, offset.x) + sector * 0.5, sector) - sector * 0.5;
  return d * cos(folded) / (radius * cos(sector * 0.5));
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  // Height units, so a disc is round and its radius is one number in both axes.
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  // Most of the radius is falloff at the default softness: a defocused highlight
  // is nearly all penumbra, and a hard-edged disc is what reads as a sticker.
  float fade = 0.06 + uSoftness * 0.92;
  vec3 accum = vec3(0.0);

  for (int i = 0; i < uDiscCount; i++) {
    vec4 disc = uDiscs[i];
    if (disc.z <= 0.0 || disc.w <= 0.0) continue;

    vec2 offset = p - disc.xy;
    // Round rejection before the aperture fold: at 64 discs most miss the pixel.
    if (dot(offset, offset) > disc.z * disc.z) continue;

    float r = apertureRadius(offset, disc.z);
    if (r > 1.0) continue;

    float body = 1.0 - smoothstep(1.0 - fade, 1.0, r);
    // Flattened top: a wide falloff alone spreads the disc so thin that a soft
    // setting reads as nothing at all. The gamma holds a plateau across the
    // interior and keeps the penumbra where the eye reads softness — the edge.
    body = pow(body, 0.6);
    // A defocused disc is not flat: the aperture rim concentrates light, so the
    // interior climbs outward before the edge falls away.
    body *= mix(0.78, 1.0, r * r);
    // Thin, or the ring merges into the body and the disc reads as a blob; too
    // thin and it reads as an outlined circle with nothing inside it.
    float ring = smoothstep(1.0 - fade * 1.4, 1.0 - fade * 0.5, r)
      * (1.0 - smoothstep(1.0 - fade * 0.5, 1.0, r));

    vec3 tint = uDiscTints[i];
    // Longitudinal chromatic aberration: on fast glass the rim of a defocused
    // highlight runs cooler than its core.
    vec3 rimColour = mix(tint, vec3(0.70, 0.85, 1.0), 0.45);

    accum += disc.w * (tint * body * 0.62 + rimColour * ring * uRim * 1.15);
  }

  // Discs overlap; additive stacking would clip to white, so this rolls off.
  vec3 colour = vec3(1.0) - exp(-accum * 1.35);
  // The canvas is opaque black under mix-blend-mode: screen, where black is the
  // identity — so no grain here: it would lift the whole page, not the discs.
  // bayerDither is an unsigned 0..1 threshold, centred here to one 8-bit step,
  // which is what keeps these very soft falloffs from banding.
  colour += (bayerDither(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

export const BOKEH_FRAGMENT_SOURCE = GLSL_COLOR + BOKEH_BODY;

/**
 * Fragment body for the WebGL burn renderer, composed onto the shared GLSL
 * chunks. `createQuadRenderer` prepends the version, the precisions, `vUv` and
 * `fragColor`, so none of those appear here.
 */

import { GLSL_COLOR, GLSL_GRAIN, GLSL_HASH, GLSL_NOISE } from '../../core/glsl';

const BURN_BODY = /* glsl */ `
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uResolution;
uniform vec2 uFromSize;
uniform vec2 uToSize;
uniform vec2 uOrigin;
uniform vec3 uBurnColor;
uniform vec3 uCharColor;
uniform float uOriginBias;
uniform float uProgress;
uniform float uEdge;
uniform float uScale;
uniform float uGrain;
uniform float uSeed;
uniform float uTime;

/** Outer edges of the scorch and heat bands, as multiples of the rim width. */
const float CHAR_BAND = 1.5;
const float HEAT_BAND = 2.2;

/** Matches CSS object-fit: cover, so a 16:9 still in a 21:9 host crops. */
vec2 coverUv(vec2 uv, vec2 src, vec2 dst) {
  float srcAspect = src.x / max(src.y, 1.0);
  float dstAspect = dst.x / max(dst.y, 1.0);
  vec2 crop = srcAspect > dstAspect
    ? vec2(dstAspect / srcAspect, 1.0)
    : vec2(1.0, srcAspect / dstAspect);
  return (uv - 0.5) * crop + 0.5;
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2(vUv.x * aspect, vUv.y);

  // Three octaves, not more: a burn hole is blotchy, and a fourth octave turns
  // the level set into lace.
  float cells = fbm2(p * uScale + vec2(uSeed * 13.7, uSeed * 7.3), 3);
  // fbm2 crowds around 0.5; widening it spends the progress sweep on visible
  // burning instead of on tails where nothing opens.
  cells = clamp((cells - 0.5) * 1.45 + 0.5, 0.0, 1.0);

  vec2 originPoint = vec2(uOrigin.x * aspect, uOrigin.y);
  float reach = max(
    max(length(originPoint), length(originPoint - vec2(aspect, 0.0))),
    max(length(originPoint - vec2(0.0, 1.0)), length(originPoint - vec2(aspect, 1.0))));
  float radial = clamp(length(p - originPoint) / max(reach, 1e-4), 0.0, 1.0);
  // Centred on zero: the bias moves where the burn starts without moving the
  // field's mean, so progress still spans clean frame to gone frame.
  float field = clamp(cells + 0.5 * uOriginBias * (radial - 0.5), 0.0, 1.0);

  // The threshold overshoots both ends so progress 0 and 1 are clean frames
  // rather than the first and last speck of noise.
  float threshold = mix(-0.06, 1.06, uProgress);
  float ahead = field - threshold;

  // fwidth converts the rim from field units into frame units: uEdge stays a
  // fraction of the frame height however steep the noise runs locally.
  float rimWidth = clamp(max(fwidth(field), 1e-5) * uEdge * uResolution.y, 1e-4, 0.4);
  float aa = max(fwidth(field), 1e-4);

  float hole = 1.0 - smoothstep(-aa, aa, ahead);
  float paperSide = 1.0 - hole;
  // Nothing is alight below this: without it the noise floor glows at rest.
  float lit = paperSide * smoothstep(0.0, 0.04, uProgress);

  float across = clamp(ahead / rimWidth, 0.0, 1.0);
  // The rim holds full strength through the white and the amber and only falls
  // off across the char, or the scorched ring has no opacity left to show in.
  float rim = (1.0 - smoothstep(0.55, 1.0, across)) * lit;
  float scorch = (1.0 - smoothstep(0.4 * rimWidth, CHAR_BAND * rimWidth, ahead)) * lit;
  // Blow-out sits outside the char, where the paper is cooking but not yet lit.
  float bloom = smoothstep(0.9 * rimWidth, 2.0 * rimWidth, ahead)
    * (1.0 - smoothstep(2.0 * rimWidth, HEAT_BAND * rimWidth, ahead)) * lit;

  vec3 fromColour = texture(uFrom, coverUv(vUv, uFromSize, uResolution)).rgb;
  vec3 toColour = texture(uTo, coverUv(vUv, uToSize, uResolution)).rgb;

  vec3 paper = fromColour * mix(1.0, 0.42, scorch);
  paper = mix(paper, filmicToneMap(paper * 2.2), bloom * 0.3);

  // Time-driven, so freezing uTime is the whole of reduced-motion support.
  float flicker = 1.0 + 0.14 * (hash11(floor(uTime * 17.0) + uSeed) - 0.5);
  vec3 ember = mix(vec3(1.0, 0.95, 0.84), uBurnColor, smoothstep(0.0, 0.4, across));
  ember = mix(ember, uCharColor, smoothstep(0.45, 1.0, across));
  paper = mix(paper, ember * flicker, rim);

  vec3 colour = mix(paper, toColour, hole);
  colour = applyGrain(colour, grain(vUv, uResolution, uTime, 1.6), uGrain * 0.16);
  // bayerDither returns an unsigned 0..1 threshold, so centre it here before
  // scaling to one 8-bit step; adding it raw would lift the whole frame.
  colour += (bayerDither(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;

export const BURN_FRAGMENT_SOURCE = GLSL_HASH + GLSL_NOISE + GLSL_GRAIN + GLSL_COLOR + BURN_BODY;

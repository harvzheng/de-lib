import { GLSL_COLOR, GLSL_HASH } from '../../core/glsl';

const DISSOLVE_BODY = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uResolution;
uniform vec2 uSourceSize;
uniform vec2 uDirection;
uniform vec3 uAshColor;
uniform float uUseAshColor;
uniform float uProgress;
uniform float uDrift;
uniform float uGrain;
uniform float uEdge;
uniform float uTurbulence;
uniform float uSeed;
uniform float uDpr;

vec2 coverUv(vec2 uv, vec2 src, vec2 dst) {
  float srcAspect = src.x / max(src.y, 1.0);
  float dstAspect = dst.x / max(dst.y, 1.0);
  vec2 crop = srcAspect > dstAspect
    ? vec2(dstAspect / srcAspect, 1.0)
    : vec2(1.0, srcAspect / dstAspect);
  return (uv - 0.5) * crop + 0.5;
}

float cellThreshold(vec2 cell, float cellPx) {
  vec2 centre = (cell + 0.5) * cellPx / uResolution;
  float directional = length(uDirection) < 0.5
    ? 0.5
    : clamp(0.5 - dot(centre - 0.5, normalize(uDirection)), 0.0, 1.0);
  float randomPart = hash12(cell + vec2(uSeed * 17.17, uSeed * 3.71));
  return clamp(0.03 + directional * 0.7 + randomPart * 0.2, 0.0, 0.93);
}

float cellAge(vec2 cell, float cellPx) {
  float detach = cellThreshold(cell, cellPx);
  return clamp((uProgress - detach) / max(1.0 - detach, 0.06), 0.0, 1.0);
}

vec2 cellDirection(vec2 cell) {
  vec2 randomVector = hash22(cell + vec2(uSeed * 5.93, uSeed * 11.31)) * 2.0 - 1.0;
  randomVector = normalize(randomVector + vec2(0.0001));
  if (length(uDirection) < 0.5) return randomVector;
  return normalize(normalize(uDirection) + randomVector * uTurbulence * 0.72);
}

vec2 cellOffset(vec2 cell, float age) {
  float motionDelay = clamp(uEdge, 0.0, 1.0) * 0.14;
  float motionAge = smoothstep(motionDelay, 1.0, age);
  float scale = mix(0.58, 1.42, hash12(cell + vec2(uSeed * 23.1, uSeed * 2.7)));
  vec2 direction = cellDirection(cell);
  vec2 perpendicular = vec2(-direction.y, direction.x);
  float flutter = sin(age * 9.42478 + hash12(cell) * 6.28318)
    * uTurbulence * uDrift * 0.12 * age;
  float extent = max(uResolution.x, uResolution.y);
  vec2 travel = direction * uDrift * extent * scale * motionAge;
  travel += perpendicular * flutter * extent;
  return travel / uResolution;
}

void main() {
  vec4 intact = texture(uSource, coverUv(vUv, uSourceSize, uResolution));
  if (uProgress <= 0.0) {
    fragColor = intact;
    return;
  }
  if (uProgress >= 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  float cellPx = max(uGrain * uDpr, 1.0);
  vec2 ownCell = floor(gl_FragCoord.xy / cellPx);
  float ownAge = cellAge(ownCell, cellPx);
  if (ownAge <= 0.0) {
    fragColor = intact;
    return;
  }

  vec2 sourceCell = ownCell;
  float sourceAge = ownAge;
  vec2 sampleUv = vUv;
  for (int i = 0; i < 2; i++) {
    sampleUv = vUv - cellOffset(sourceCell, sourceAge);
    sourceCell = floor(sampleUv * uResolution / cellPx);
    sourceAge = cellAge(sourceCell, cellPx);
  }

  bool inBounds = all(greaterThanEqual(sampleUv, vec2(0.0)))
    && all(lessThanEqual(sampleUv, vec2(1.0)));
  vec4 fragment = texture(uSource, coverUv(sampleUv, uSourceSize, uResolution));
  float fade = 1.0 - smoothstep(0.38, 1.0, sourceAge);
  float opacity = inBounds && sourceAge > 0.0 ? fragment.a * fade : 0.0;
  fragment.rgb = mix(fragment.rgb, uAshColor, uUseAshColor * smoothstep(0.05, 0.7, sourceAge));
  fragment.rgb += (bayerDither(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(clamp(fragment.rgb, 0.0, 1.0), opacity);
}
`;

export const DISSOLVE_FRAGMENT_SOURCE = GLSL_HASH + GLSL_COLOR + DISSOLVE_BODY;

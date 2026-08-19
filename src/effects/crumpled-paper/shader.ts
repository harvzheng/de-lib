/**
 * Fragment body for the WebGL crumple renderer. `createQuadRenderer` prepends the
 * version, the precisions, `vUv` and `fragColor`, so none of those appear here.
 *
 * The surface is a **max of cones**: every cell of a jittered grid owns a site with
 * its own height and slope, and the sheet's height at a pixel is the highest cone
 * over it. The maximum of such functions is a power diagram — polygonal panels
 * meeting along creases — which is what a crumpled sheet is. Three octaves of it
 * give big panels with finer wrinkles running across them, and the cells are
 * stretched along a per-cell axis so the panels come out irregular rather than
 * honeycomb-regular.
 *
 * Normals come from finite differences of that field at float precision. That is
 * the reason this path exists at all: SVG's filter pipeline carries the height map
 * as 8-bit alpha, and amplifying a broad fold's gradient out of 8 bits bands it
 * into contour rings — measured, not assumed. Nothing here is per-frame; the quad
 * is redrawn only when an option or the light angle changes.
 */

import { GLSL_HASH, GLSL_NOISE } from '../../core/glsl';

const CRUMPLE_BODY = /* glsl */ `
uniform vec2 uResolution;
uniform float uDpr;
uniform float uScale;
uniform float uDepth;
uniform float uSharpness;
uniform float uAzimuth;
uniform float uElevation;
uniform float uShine;
uniform float uGrain;
uniform float uSoiling;
uniform float uStrength;
uniform vec3 uPaper;
uniform float uTone;
uniform float uSeed;

const float TAU = 6.28318530718;
/** Panels, wrinkles, and the fine break-up on top of them. */
const int OCTAVES = 3;

/**
 * Smooth maximum. This is what turns a crease from a scratch into a crease: a hard
 * "max" flips the normal over one pixel, and lighting a discontinuity draws a 1px
 * line. Rounding the join by "k" gives the fold a fillet, which is what real paper
 * has — the fibres cannot take a zero-radius bend.
 */
float smax(float a, float b, float k) {
  float t = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(a, b, t) + k * t * (1.0 - t);
}

/**
 * Height of one octave: the highest cone over this pixel, joined smoothly. 3x3 is
 * exact as long as the site jitter stays inside its cell and no further cell's cone
 * can win, which is what the jitter and slope ranges below are chosen for.
 */
float conesAt(vec2 p, float cell, float seed, float fillet) {
  vec2 grid = floor(p / cell);
  float best = -4.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = grid + vec2(float(i), float(j));
      vec2 jitter = hash22(id + vec2(seed, seed * 1.7));
      // Nearly the whole cell: a tidy grid of sites reads as a honeycomb, and paper
      // panels are not the same size as each other.
      vec2 site = (id + 0.08 + 0.84 * jitter) * cell;

      vec2 shape = hash22(id * 1.37 + vec2(seed * 2.3, 9.1));
      // Stretch the cell's distance metric along its own axis: paper panels are long
      // and angular, and an isotropic metric gives circles.
      float angle = shape.x * TAU;
      vec2 axis = vec2(cos(angle), sin(angle));
      vec2 d = (p - site) / cell;
      vec2 local = vec2(dot(d, axis), dot(d, vec2(-axis.y, axis.x)));
      local.x /= mix(1.0, 2.6, shape.y);

      float lift = hash12(id * 2.11 + seed) * 0.55;
      float slope = mix(0.55, 1.0, hash12(id * 3.71 + seed + 5.3));
      best = smax(best, lift - slope * length(local), fillet);
    }
  }
  return best;
}

/** The sheet's height in cell-normalised units, positive up. */
float sheetHeight(vec2 p) {
  float cell = max(uScale, 24.0);
  float amplitude = 1.0;
  float total = 0.0;
  float weight = 0.0;
  // Sharper crumple means a tighter fold radius as well as more fine structure.
  float fillet = mix(0.16, 0.05, uSharpness);

  // Warping the sample position before the lattice is what hides the lattice. The
  // cones live on a square grid, and without this the grid reads straight through
  // the shading as a faint plaid — worse for being the only regular thing in the
  // picture. The warp is a fraction of a cell, so panels keep their size.
  vec2 warp = vec2(
    vnoise2(p / (cell * 2.2) + uSeed),
    vnoise2(p / (cell * 2.2) + uSeed + 11.7)) - 0.5;
  p += warp * cell * 0.85;

  for (int octave = 0; octave < OCTAVES; octave++) {
    // Each octave gets its own rotation, or the octaves share the lattice they are
    // meant to be breaking up and their cell edges pile onto the same lines.
    float turn = 0.9 + float(octave) * 1.31;
    mat2 spin = mat2(cos(turn), -sin(turn), sin(turn), cos(turn));
    total += conesAt(spin * p, cell, uSeed + float(octave) * 17.3, fillet) * amplitude;
    weight += amplitude;
    // Not a power of two: octaves an octave apart share their harmonics, and the
    // shared ones are exactly the cell edges.
    cell *= 0.37;
    // Each octave is a finer crumple laid over the last, and it has to stay a
    // minority or the panels vanish under a web of small creases.
    amplitude *= mix(0.15, 0.32, uSharpness);
  }
  return total / max(weight, 1e-4);
}

void main() {
  // Work in CSS px so a crease is the same size whatever the device pixel ratio.
  vec2 p = vUv * uResolution / max(uDpr, 0.001);
  p.y = uResolution.y / max(uDpr, 0.001) - p.y;

  // The field is normalised per octave by its own cell size, so its gradient falls
  // as 1/cell — relief has to rise with the panel size to keep the same crease
  // angles at any crumple. The constant is what puts a typical crease near 40deg.
  float relief = (0.6 + uDepth * 3.4) * max(uScale, 24.0) * 0.075;
  // One CSS px either side: the creases are the sharpest thing in the field, and a
  // wider step rounds them off.
  float eps = 1.0;
  float h = sheetHeight(p);
  float hx = sheetHeight(p + vec2(eps, 0.0));
  float hy = sheetHeight(p + vec2(0.0, eps));

  vec3 normal = normalize(vec3(-(hx - h) * relief / eps, -(hy - h) * relief / eps, 1.0));

  float azimuth = radians(uAzimuth);
  float elevation = radians(uElevation);
  vec3 light = normalize(vec3(cos(azimuth) * cos(elevation), sin(azimuth) * cos(elevation), sin(elevation)));

  float lambert = max(dot(normal, light), 0.0);
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  // Broad, not tight. The sheen is the only part of the sheet that shows on dark
  // ink — it is light reflecting off the surface rather than the print showing
  // through it — and a mirror-tight exponent only ever catches a few pixels.
  float spec = pow(max(dot(normal, halfway), 0.0), 18.0) * uShine * 2.2;

  // Valleys keep less light: the sheet shades itself where it folded into itself,
  // and this is most of where a crumpled sheet gets its darks from.
  float occlusion = smoothstep(-0.6, 0.3, h);
  // Normalised against what a *flat* sheet returns, so flat paper paints nothing at
  // all and only the relief shows. Without this the whole layer dims the content by
  // a constant, which reads as a grey wash rather than as paper.
  // Named around the reserved word: "flat" is an interpolation qualifier in GLSL ES
  // 3.00, and using it as an identifier is a compile error in Gecko and Blink alike.
  float flatShade = 0.34 + 0.78 * max(sin(elevation), 0.001);
  float shade = ((0.34 + 0.78 * lambert) / flatShade) * mix(0.68, 1.0, occlusion) + spec;

  // Fibre tooth, at pixel scale and unlit: paper grain is scatter, not relief.
  float tooth = (hash12(floor(vUv * uResolution) + uSeed) - 0.5) * uGrain * 0.12;
  shade += tooth;

  // Dirt collects in the deep folds rather than everywhere the sheet is dark.
  float dirt = (1.0 - smoothstep(-0.8, -0.15, h)) * uSoiling * 0.4;

  float delta = shade - 1.0;
  // Alpha-only compositing: darkening paints toward the shadow colour, lightening
  // toward the paper's own lit tone, and a flat area paints nothing at all. That
  // keeps the layer engine-neutral — no blend mode, so nothing depends on how an
  // engine isolates a stacking context.
  vec3 lit = mix(vec3(1.0), uPaper, uTone * 0.5);
  // Near-black, only faintly warmed by the stock. Mixing the paper colour into the
  // shadow at any strength is what turned the creases into mid-brown smudges: a
  // fold in paper occludes light, and occluded light is dark, not beige.
  vec3 shadow = uPaper * 0.06;
  vec3 colour = delta >= 0.0 ? lit : shadow;

  // The dark side is curved and gained: a crease bottoms out faster than it lights
  // up, so the same |delta| has to read deeper below neutral than above it.
  float alpha = delta >= 0.0
    ? delta * uStrength
    : pow(-delta, 0.85) * uStrength * 1.2 + dirt;
  fragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
}
`;

export const CRUMPLE_FRAGMENT_SOURCE = GLSL_HASH + GLSL_NOISE + CRUMPLE_BODY;

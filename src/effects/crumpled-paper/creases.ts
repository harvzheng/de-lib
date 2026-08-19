/**
 * The crease structure of a crumpled sheet, as data. Pure and deterministic:
 * shapes in, no drawing here — `index.ts` rasterises them into a height map once
 * and SVG lighting does the rest.
 *
 * Why shapes and not noise: a crumpled sheet is made of creases, and a crease is a
 * *finite straight line* with paper falling away either side of it. Turbulence has
 * no straight anything, so it can only ever read as stucco. Two populations, in
 * the proportions real paper has them:
 *
 * - `crease` — a needle: long, a few px across, sharp. These are the lines you see.
 * - `swell` — a broad soft dome, several times the crease spacing across. These are
 *   the panels between the creases that never went flat again, and they are what
 *   makes one facet catch the light while its neighbour turns away.
 *
 * Both are ellipses rather than infinite bands on purpose: an infinite band ends
 * at the sheet edge with a hard mitre, and a sheet full of those reads as shattered
 * glass. An ellipse fades out along its own length, so a crease can stop.
 */

import { clamp, clamp01, lerp, mulberry32 } from '../../core/math';

export type CreaseKind = 'crease' | 'swell';

export interface Crease {
  kind: CreaseKind;
  /** Centre in px. */
  cx: number;
  cy: number;
  /** Orientation in radians. */
  angle: number;
  /** Half-length along its own axis, in px. */
  length: number;
  /** Half-width across it, in px. A crease is a needle; a swell is nearly round. */
  reach: number;
  /** Peak height, 0..1 of the map's range. */
  amplitude: number;
}

export interface CreaseFieldOptions {
  width: number;
  height: number;
  /** Target px between creases: how hard the sheet was crumpled. */
  scale: number;
  /** 0..1 — how much of the structure is sharp creases rather than broad swells. */
  sharpness: number;
  seed: number;
}

const MIN_CREASES = 8;
const MAX_CREASES = 90;
const MIN_SWELLS = 4;
const MAX_SWELLS = 26;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function buildCreases(options: CreaseFieldOptions): Crease[] {
  const width = Math.max(0, finite(options.width));
  const height = Math.max(0, finite(options.height));
  const span = Math.max(24, finite(options.scale));
  const sharpness = clamp01(options.sharpness);
  const random = mulberry32(options.seed * 1597334677 + 0x51ed);

  // Counts follow the sheet's area over the crease spacing, so the same options
  // crumple a thumbnail and a full-bleed hero to the same visual density.
  const cells = (width * height) / (span * span);
  const creases = Math.round(clamp(cells * lerp(2.2, 5.5, sharpness), MIN_CREASES, MAX_CREASES));
  const swells = Math.round(clamp(cells * 0.9, MIN_SWELLS, MAX_SWELLS));

  const shapes: Crease[] = [];

  for (let i = 0; i < swells; i += 1) {
    const reach = span * lerp(0.55, 1.15, random());
    shapes.push({
      kind: 'swell',
      cx: finite(random() * width),
      cy: finite(random() * height),
      angle: random() * Math.PI,
      length: finite(reach * lerp(1, 2.2, random())),
      reach: finite(reach),
      // Divided by the count: swells overlap everywhere, so their sum is what has
      // to stay inside the map's range, not any one of them.
      amplitude: (lerp(0.5, 1, random()) / Math.sqrt(swells)) * lerp(1.15, 0.7, sharpness),
    });
  }

  for (let i = 0; i < creases; i += 1) {
    shapes.push({
      kind: 'crease',
      cx: finite(random() * width),
      cy: finite(random() * height),
      angle: random() * Math.PI,
      // A crease runs a good way across a panel; too short and it reads as a dent.
      length: finite(span * lerp(0.45, 1.7, random())),
      // A few px across at a normal crumple, which is what keeps the line sharp.
      reach: finite(clamp(span * lerp(0.012, 0.045, random()), 1.2, 26)),
      // Low: a crease is a slope change between two facets, not a raised welt.
      // Push this and every crease reads as a scratch on glass instead.
      amplitude: lerp(0.12, 0.34, random()) * lerp(0.55, 1, sharpness),
    });
  }

  return shapes;
}

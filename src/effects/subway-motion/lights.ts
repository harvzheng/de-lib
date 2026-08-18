import { clamp01, mulberry32 } from '../../core/math';

export interface SubwayLightGeometry {
  /** Deep tunnel wall haze: sparse, wide, slowest of the three depth bands. */
  farGradient: string;
  /** The tunnel lamp line — the band that carries the "subway" read. */
  lampGradient: string;
  /** Near wall ribs and cable runs: thin, fastest, most smeared. */
  nearGradient: string;
  farPhase: number;
  lampPhase: number;
  nearPhase: number;
  /** Station events in 0..1 cycle space, ascending. */
  stationPoints: readonly number[];
}

interface StripSpec {
  /** Rhythm slots across one tile. A tile is exactly one host width. */
  slots: number;
  /** Slot-relative jitter: a real tunnel is regularly spaced but not milled. */
  jitter: number;
  minWidth: number;
  maxWidth: number;
  /** Chance a slot stays empty — the dark stretches between lamp runs. */
  gapChance: number;
  /** Chance a slot carries a second lamp close behind the first. */
  doubleChance: number;
  /** Halo width as a multiple of the core width. */
  halo: number;
  /** Trailing smear as a multiple of `--subway-motion-tail`. */
  tail: number;
}

/**
 * One tile of a repeating strip. Stops are percentages of the tile, which the
 * `background-size: 25% 100%` on a 400%-wide strip makes exactly one host
 * width — so `--subway-motion-tail` reads in the same units on every strip.
 *
 * The strip travels left, so the smear trails to the right of each core: a hard
 * leading edge, a long trailing feather.
 */
function stripGradient(random: () => number, spec: StripSpec): string {
  const slot = 100 / spec.slots;
  const stops: string[] = ['transparent 0%'];
  let cursor = 0;

  function emit(wantedCenter: number, width: number): void {
    const halo = width * spec.halo;
    const left = Math.max(cursor, wantedCenter - width * 0.5);
    const right = left + width;
    // Tails are clamped at the tile edge, which would cut a hard seam where the
    // strip repeats, so the last slot of a tile stays clear of the longest tail.
    if (right > 95) return;

    const lead = Math.max(cursor, left - halo);
    stops.push(
      `transparent ${lead.toFixed(3)}%`,
      `var(--subway-motion-strip-glow) ${Math.max(lead, left - halo * 0.4).toFixed(3)}%`,
      `var(--subway-motion-strip-core) ${left.toFixed(3)}%`,
      `var(--subway-motion-strip-core) ${right.toFixed(3)}%`,
      `var(--subway-motion-strip-glow) calc(${right.toFixed(3)}% + var(--subway-motion-tail) * ${(spec.tail * 0.4).toFixed(3)})`,
      `transparent calc(${right.toFixed(3)}% + var(--subway-motion-tail) * ${spec.tail.toFixed(3)})`,
    );
    cursor = right + halo + 0.35;
  }

  for (let index = 0; index < spec.slots; index += 1) {
    if (random() < spec.gapChance) continue;
    const width = spec.minWidth + random() * (spec.maxWidth - spec.minWidth);
    emit(slot * (index + 0.5) + (random() - 0.5) * slot * spec.jitter, width);
    if (random() < spec.doubleChance) emit(cursor + width * 0.9, width * 0.82);
  }

  stops.push('transparent 100%');
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function buildSubwayLightGeometry(seed: number, density: number): SubwayLightGeometry {
  const random = mulberry32(Math.trunc(seed));
  const amount = clamp01(density);
  const stationCount = 1 + Math.round(amount * 2);

  return {
    farGradient: stripGradient(random, {
      slots: 2 + Math.round(amount * 2),
      jitter: 0.55,
      minWidth: 9,
      maxWidth: 19,
      gapChance: 0.22,
      doubleChance: 0,
      halo: 1.1,
      tail: 0.6,
    }),
    lampGradient: stripGradient(random, {
      slots: 5 + Math.round(amount * 3),
      jitter: 0.26,
      minWidth: 1.5,
      maxWidth: 2.8,
      gapChance: 0.15,
      doubleChance: 0.18,
      halo: 2.2,
      tail: 1.5,
    }),
    nearGradient: stripGradient(random, {
      slots: 4 + Math.round(amount * 3),
      jitter: 0.5,
      minWidth: 9,
      maxWidth: 22,
      gapChance: 0.08,
      doubleChance: 0.2,
      halo: 0.55,
      tail: 2.4,
    }),
    farPhase: random(),
    lampPhase: random(),
    nearPhase: random(),
    stationPoints: Array.from({ length: stationCount }, () => random()).sort((a, b) => a - b),
  };
}

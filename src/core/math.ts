/**
 * Scalar helpers shared by every effect. Kept allocation-free: these run per
 * frame, sometimes per element.
 */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  const inverted = 1 - t;
  return 1 - inverted * inverted * inverted;
}

/** Deterministic 32-bit PRNG (mulberry32). Same seed always yields the same sequence. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Power of two so the lattice index wraps with a mask instead of a modulo. */
const WAVE_TABLE_SIZE = 256;

/**
 * Smooth 1D value noise from a seeded PRNG — a hand-drawn wobble, not white
 * noise. Returns a function of x with roughly unit amplitude, continuous in x.
 */
export function seededWave(seed: number): (x: number) => number {
  const random = mulberry32(seed);
  const table = new Float64Array(WAVE_TABLE_SIZE);
  for (let i = 0; i < WAVE_TABLE_SIZE; i += 1) table[i] = random() * 2 - 1;

  const sample = (p: number): number => {
    const cell = Math.floor(p);
    const t = p - cell;
    const a = table[cell & (WAVE_TABLE_SIZE - 1)];
    const b = table[(cell + 1) & (WAVE_TABLE_SIZE - 1)];
    return a + (b - a) * (t * t * (3 - 2 * t));
  };

  // Two octaves: the base carries the wobble, the detail octave keeps it from
  // reading as a sine. The offset stops both octaves sharing lattice points.
  return (x: number): number => (sample(x) + 0.5 * sample(x * 2 + 37.13)) / 1.5;
}

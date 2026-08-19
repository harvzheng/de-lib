/**
 * Where bokeh actually forms. A defocused disc is not a decoration dropped at
 * random: it is one specular highlight — a street lamp, a reflection, a gap in
 * foliage — spread across the aperture. So the discs are placed by finding the
 * bright, locally isolated points in the content and putting a disc on each.
 *
 * Pure and array-in/array-out: the caller does the rasterising (see `index.ts`),
 * this only reads pixels. It runs when the source or the host box changes, never
 * per frame — there is no readback in the render path.
 */

export interface HighlightScanOptions {
  /** Dimensions of the RGBA sample grid. */
  width: number;
  height: number;
  /** Maximum highlights to return, strongest first. */
  count: number;
  /**
   * Score floor as a fraction of the strongest peak found, 0..1. Relative
   * rather than absolute so a dim frame still yields its own brightest points.
   */
  threshold: number;
  /** Minimum spacing between kept peaks, in normalised units of the grid. */
  separation: number;
}

export interface Highlight {
  /** Position in the sampled box, 0..1. */
  x: number;
  y: number;
  /** Peak strength, 0..1 — brightness times local isolation. */
  weight: number;
  /** The highlight's own colour, 0..255 per channel. */
  color: [number, number, number];
}

/** Cells across the short axis of the local-mean window; a lamp is small. */
const WINDOW_DIVISOR = 10;

/** Separable box blur, one axis per pass. Radius is in cells. */
function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const horizontal = new Float32Array(width * height);
  const span = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let k = -radius; k <= radius; k += 1) {
        // Clamped edges: a mirrored edge invents contrast that is not there.
        const sx = Math.min(width - 1, Math.max(0, x + k));
        total += source[row + sx];
      }
      horizontal[row + x] = total / span;
    }
  }

  const blurred = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        total += horizontal[sy * width + x];
      }
      blurred[y * width + x] = total / span;
    }
  }
  return blurred;
}

/**
 * Bright local maxima, non-maximum suppressed. The score is local contrast
 * times absolute brightness: contrast alone promotes any hard edge, brightness
 * alone promotes the whole sky, and a defocused disc needs both.
 */
export function findHighlights(
  pixels: Uint8ClampedArray,
  options: HighlightScanOptions,
): Highlight[] {
  const { width, height } = options;
  const cells = width * height;
  if (cells <= 0 || pixels.length < cells * 4) return [];

  const luma = new Float32Array(cells);
  for (let i = 0; i < cells; i += 1) {
    const p = i * 4;
    luma[i] = (0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2]) / 255;
  }

  const radius = Math.max(1, Math.round(Math.min(width, height) / WINDOW_DIVISOR));
  const mean = boxBlur(luma, width, height, radius);

  const scored: { index: number; score: number }[] = [];
  let strongest = 0;
  for (let i = 0; i < cells; i += 1) {
    // Local contrast, times brightness, times how dark the surround is. The last
    // term is what makes the result usable: a disc dropped into an already-bright
    // region adds nothing a screen blend can show, while the same disc over a
    // dark surround is the shot everyone photographs at f/1.4.
    const score = Math.max(0, luma[i] - mean[i]) * luma[i] * (1 - mean[i] * 0.85);
    if (score <= 0) continue;
    if (score > strongest) strongest = score;
    scored.push({ index: i, score });
  }
  if (strongest <= 0) return [];

  scored.sort((a, b) => b.score - a.score);

  const floor = strongest * Math.min(Math.max(options.threshold, 0), 1);
  const separation = Math.max(options.separation, 0);
  const kept: Highlight[] = [];

  for (const candidate of scored) {
    if (kept.length >= options.count) break;
    if (candidate.score < floor) break;

    const cx = (candidate.index % width) / Math.max(width - 1, 1);
    const cy = Math.floor(candidate.index / width) / Math.max(height - 1, 1);

    let crowded = false;
    for (const existing of kept) {
      const dx = existing.x - cx;
      const dy = existing.y - cy;
      if (dx * dx + dy * dy < separation * separation) {
        crowded = true;
        break;
      }
    }
    if (crowded) continue;

    const p = candidate.index * 4;
    kept.push({
      x: cx,
      y: cy,
      weight: candidate.score / strongest,
      color: [pixels[p], pixels[p + 1], pixels[p + 2]],
    });
  }

  return kept;
}

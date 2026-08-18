import { clamp01, mulberry32, seededWave } from '../../core/math';

export type ImpactShape = 'starburst' | 'cloud' | 'jagged' | 'spike';

export interface BurstGeometryOptions {
  width: number;
  height: number;
  shape: ImpactShape;
  points: number;
  irregularity: number;
  speedLines: number;
  seed: number;
}

export interface BurstLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BurstGeometry {
  path: string;
  lines: BurstLine[];
}

const TAU = Math.PI * 2;

const SHAPE_RADII: Record<ImpactShape, readonly [outer: number, inner: number]> = {
  starburst: [1, 0.57],
  cloud: [0.94, 0.82],
  jagged: [0.98, 0.69],
  spike: [1.16, 0.46],
};

/** Builds the decorative polygon and speed lines without touching the DOM. */
export function buildBurstGeometry(options: BurstGeometryOptions): BurstGeometry {
  const points = Math.max(3, Math.round(options.points));
  const lineCount = Math.max(0, Math.min(24, Math.round(options.speedLines)));
  const irregularity = clamp01(options.irregularity);
  const width = Math.max(0, options.width);
  const height = Math.max(0, options.height);
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.max(18, width * 0.68 + 22);
  const radiusY = Math.max(18, height * 0.82 + 22);
  const [outerRadius, innerRadius] = SHAPE_RADII[options.shape];
  const random = mulberry32(options.seed >>> 0);
  const wave = seededWave((options.seed * 2654435761) >>> 0);
  const vertexTotal = points * 2;
  const vertices: { x: number; y: number }[] = [];

  for (let index = 0; index < vertexTotal; index += 1) {
    const outer = index % 2 === 0;
    const baseRadius = outer ? outerRadius : innerRadius;
    const radialJitter = (random() - 0.5) * irregularity * (outer ? 0.34 : 0.22);
    const angularJitter = wave(index * 0.63) * irregularity * (TAU / vertexTotal) * 0.42;
    const angle = -Math.PI / 2 + (index / vertexTotal) * TAU + angularJitter;
    const radius = baseRadius * (1 + radialJitter);
    vertices.push({
      x: centerX + Math.cos(angle) * radiusX * radius,
      y: centerY + Math.sin(angle) * radiusY * radius,
    });
  }

  let path: string;
  if (options.shape === 'cloud') {
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    const segments = [
      `M${((last.x + first.x) / 2).toFixed(2)},${((last.y + first.y) / 2).toFixed(2)}`,
    ];
    for (let index = 0; index < vertices.length; index += 1) {
      const vertex = vertices[index];
      const next = vertices[(index + 1) % vertices.length];
      segments.push(
        `Q${vertex.x.toFixed(2)},${vertex.y.toFixed(2)} ` +
          `${((vertex.x + next.x) / 2).toFixed(2)},${((vertex.y + next.y) / 2).toFixed(2)}`,
      );
    }
    path = `${segments.join(' ')} Z`;
  } else {
    path = `${vertices
      .map(
        (vertex, index) =>
          `${index === 0 ? 'M' : 'L'}${vertex.x.toFixed(2)},${vertex.y.toFixed(2)}`,
      )
      .join(' ')} Z`;
  }

  const lineRandom = mulberry32((options.seed ^ 0x9e3779b9) >>> 0);
  const lines: BurstLine[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const angle = (index / Math.max(lineCount, 1)) * TAU + (lineRandom() - 0.5) * 0.18;
    const start = 1.08 + lineRandom() * 0.1;
    const end = start + 0.24 + lineRandom() * 0.26;
    lines.push({
      x1: Number((centerX + Math.cos(angle) * radiusX * start).toFixed(2)),
      y1: Number((centerY + Math.sin(angle) * radiusY * start).toFixed(2)),
      x2: Number((centerX + Math.cos(angle) * radiusX * end).toFixed(2)),
      y2: Number((centerY + Math.sin(angle) * radiusY * end).toFixed(2)),
    });
  }

  return { path, lines };
}

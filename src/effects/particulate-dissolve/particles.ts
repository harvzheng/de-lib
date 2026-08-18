import { clamp01, mulberry32, smoothstep } from '../../core/math';
import type { DissolveDirection } from './index';

export interface ParticleBuildOptions {
  width: number;
  height: number;
  grain: number;
  count: number;
  seed: number;
  direction: DissolveDirection;
}

export interface ParticleStateOptions {
  width: number;
  height: number;
  drift: number;
  turbulence: number;
  direction: DissolveDirection;
}

export interface DissolveParticle {
  identity: number;
  x: number;
  y: number;
  size: number;
  aspect: number;
  detach: number;
  life: number;
  angle: number;
  driftScale: number;
  curl: number;
  rotation: number;
}

export interface DissolveParticleState {
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  scale: number;
}

const TAU = Math.PI * 2;
const MAX_PARTICLES = 1400;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function directionalPhase(x: number, y: number, direction: DissolveDirection): number {
  switch (direction) {
    case 'left':
      return x;
    case 'right':
      return 1 - x;
    case 'up':
      return y;
    case 'down':
      return 1 - y;
    case 'random':
      return 0.5;
  }
}

function directionAngle(direction: DissolveDirection, fallback: number): number {
  switch (direction) {
    case 'left':
      return Math.PI;
    case 'right':
      return 0;
    case 'up':
      return -Math.PI / 2;
    case 'down':
      return Math.PI / 2;
    case 'random':
      return fallback;
  }
}

export function createParticles(options: ParticleBuildOptions): DissolveParticle[] {
  const width = Math.max(0, finite(options.width));
  const height = Math.max(0, finite(options.height));
  const grain = Math.max(0, finite(options.grain));
  const count = Math.min(MAX_PARTICLES, Math.max(0, Math.floor(finite(options.count))));
  const random = mulberry32(options.seed);
  const particles: DissolveParticle[] = [];

  for (let identity = 0; identity < count; identity += 1) {
    const nx = random();
    const ny = random();
    const jitter = random();
    const detach = clamp01(0.03 + directionalPhase(nx, ny, options.direction) * 0.7 + jitter * 0.2);
    const angle = random() * TAU;

    particles.push({
      identity,
      x: nx * width,
      y: ny * height,
      size: grain * (0.45 + random() * 1.25),
      aspect: 0.45 + random() * 1.15,
      detach,
      life: Math.max(0.06, 1 - detach),
      angle,
      driftScale: 0.55 + random() * 0.9,
      curl: random() * 2 - 1,
      rotation: (random() * 2 - 1) * TAU * 1.5,
    });
  }

  return particles;
}

export function particleState(
  particle: DissolveParticle,
  progress: number,
  options: ParticleStateOptions,
): DissolveParticleState {
  const p = clamp01(finite(progress));
  const age = clamp01((p - particle.detach) / particle.life);
  if (p === 0 || p === 1 || age === 0) {
    return { x: particle.x, y: particle.y, rotation: 0, opacity: 0, scale: 0 };
  }

  const width = Math.max(0, finite(options.width));
  const height = Math.max(0, finite(options.height));
  const extent = Math.max(width, height);
  const drift = Math.max(0, finite(options.drift)) * extent * particle.driftScale;
  const turbulence = clamp01(finite(options.turbulence));
  const baseAngle = directionAngle(options.direction, particle.angle);
  const angled = baseAngle + particle.curl * turbulence * 0.75;
  const travel = smoothstep(0, 1, age);
  const flutter = Math.sin(age * Math.PI * 3 + particle.angle) * turbulence * drift * 0.12 * age;
  const perpendicular = angled + Math.PI / 2;
  const x = particle.x + Math.cos(angled) * drift * travel + Math.cos(perpendicular) * flutter;
  const y = particle.y + Math.sin(angled) * drift * travel + Math.sin(perpendicular) * flutter;
  const fadeIn = smoothstep(0, 0.12, age);
  const fadeOut = 1 - smoothstep(0.45, 1, age);

  return {
    x: finite(x),
    y: finite(y),
    rotation: finite(particle.rotation * age),
    opacity: clamp01(fadeIn * fadeOut),
    scale: finite(0.55 + age * 0.45),
  };
}

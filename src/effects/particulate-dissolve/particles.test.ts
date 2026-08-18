import { describe, expect, test } from 'bun:test';

import { createParticles, particleState } from './particles';
import type { ParticleBuildOptions, ParticleStateOptions } from './particles';

const BUILD: ParticleBuildOptions = {
  width: 640,
  height: 360,
  grain: 6,
  count: 120,
  seed: 17,
  direction: 'up',
};

const STATE: ParticleStateOptions = {
  width: 640,
  height: 360,
  drift: 0.45,
  turbulence: 0.35,
  direction: 'up',
};

describe('particulate dissolve particles', () => {
  test('the same seed produces identical particle geometry', () => {
    expect(createParticles(BUILD)).toEqual(createParticles(BUILD));
  });

  test('different seeds produce different particle geometry', () => {
    expect(createParticles({ ...BUILD, seed: 18 })).not.toEqual(createParticles(BUILD));
  });

  test('particle state is identical when the same progress is revisited', () => {
    const particles = createParticles(BUILD);
    const frames = [0.6, 0.3, 0.6].map((progress) =>
      particles.map((particle) => particleState(particle, progress, STATE)),
    );

    expect(frames[2]).toEqual(frames[0]);
    expect(frames[1]).not.toEqual(frames[0]);
  });

  test('progress zero and one have clean endpoints', () => {
    const particles = createParticles(BUILD);

    for (const particle of particles) {
      expect(particleState(particle, 0, STATE).opacity).toBe(0);
      expect(particleState(particle, 1, STATE).opacity).toBe(0);
    }
  });

  test('a zero-size box produces no NaN', () => {
    const options = { ...BUILD, width: 0, height: 0 };
    const stateOptions = { ...STATE, width: 0, height: 0 };
    const particles = createParticles(options);

    for (const particle of particles) {
      for (const value of Object.values(particle)) expect(Number.isFinite(value)).toBe(true);
      for (const value of Object.values(particleState(particle, 0.5, stateOptions))) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

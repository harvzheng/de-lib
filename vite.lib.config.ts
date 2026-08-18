import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const effectsDir = resolve(root, 'src/effects');

/**
 * One effect per build. Rollup hoists anything two entries share into a side
 * chunk, and `dist/lib/<slug>.js` has to run on its own, so `build:lib` invokes
 * this config once per slug instead of handing it all four at once.
 */
const only = process.env.LIB_SLUG;

/** Every directory under `src/effects` that has a factory to build. */
function slugs(): string[] {
  if (!existsSync(effectsDir)) return [];
  const found = readdirSync(effectsDir).filter((slug) =>
    existsSync(resolve(effectsDir, slug, 'index.ts')),
  );
  return only === undefined ? found : found.filter((slug) => slug === only);
}

function entries(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slug of slugs()) out[slug] = resolve(effectsDir, slug, 'index.ts');
  return out;
}

/**
 * Effect sources never import their own stylesheet — both documented delivery
 * modes have the consumer import it — so nothing pulls `effect.css` into the
 * bundle graph and Rollup would emit no CSS at all. Copy each one out beside
 * its entry instead. They reference nothing but data URIs, so no rewriting.
 */
function emitEffectStyles(): Plugin {
  return {
    name: 'web-effects-pack:effect-styles',
    generateBundle() {
      for (const slug of slugs()) {
        const stylesheet = resolve(effectsDir, slug, 'effect.css');
        if (!existsSync(stylesheet)) continue;
        this.emitFile({
          type: 'asset',
          fileName: `${slug}.css`,
          source: readFileSync(stylesheet, 'utf8'),
        });
      }
    },
  };
}

/**
 * Library build: one self-contained ESM file + one CSS file per effect, so a
 * single effect can be dropped into any page without taking the whole pack.
 */
export default defineConfig({
  // The pack's sample footage belongs to the demo pages, not to a library drop.
  publicDir: false,
  plugins: [emitEffectStyles()],
  build: {
    target: 'es2022',
    outDir: 'dist/lib',
    // The script clears the directory once, before the first slug.
    emptyOutDir: only === undefined,
    cssCodeSplit: true,
    lib: { entry: entries(), formats: ['es'] },
  },
});

import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const effectsDir = resolve(root, 'src/effects');

/** Every effect ships its own `demo.html`; the root `index.html` is the gallery. */
function pages(): Record<string, string> {
  const inputs: Record<string, string> = { gallery: resolve(root, 'index.html') };
  if (!existsSync(effectsDir)) return inputs;
  for (const slug of readdirSync(effectsDir)) {
    const demo = resolve(effectsDir, slug, 'demo.html');
    if (existsSync(demo)) inputs[slug] = demo;
  }
  return inputs;
}

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: { input: pages() },
  },
});

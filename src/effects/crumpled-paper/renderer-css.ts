/**
 * CSS/SVG crumple renderer — the floor that works without a GPU.
 *
 * Canvas 2D bakes the crease field into a height map once (one radial gradient per
 * crease and swell, summed in `lighter`), and SVG `feDiffuseLighting` shades that
 * map live, so moving the light re-lights the same sheet without re-baking it.
 *
 * What it gives up against the WebGL renderer is precision, not structure: the map
 * travels through the filter pipeline as 8-bit alpha, so the relief it can carry
 * before banding is limited, and the panels are drawn as overlapping ellipses
 * rather than solved as a power diagram.
 */

import { clamp01, lerp } from '../../core/math';
import { createFilter } from '../../core/svg';
import { buildCreases } from './creases';
import type { FilterHandle } from '../../core/svg';
import type { CrumpledConfig, CrumpledRendererInstance } from './index';

/**
 * Long side of the baked height map. The map carries shading, not detail, so it is
 * baked at CSS px and never at device pixels — and capped, because the bake is one
 * gradient fill per crease over the whole canvas.
 */
const MAP_MAX_PX = 1400;

/**
 * Lights the baked map. `SourceGraphic` is the map itself (the layer's background),
 * so the chain is: luminance to alpha, a whisker of blur to take the gradient
 * banding off the crease apexes, then the lighting.
 *
 * The subregion is padded because a lit surface's normals are undefined at the
 * filter region's edge, which otherwise leaves a bright frame around the sheet.
 */
const SHEET_FILTER = `
<filter color-interpolation-filters="sRGB" x="-4%" y="-4%" width="108%" height="108%">
  <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="height"/>
  <feGaussianBlur data-p="soften" in="height" stdDeviation="0.8" result="field"/>

  <feDiffuseLighting data-p="diffuse" in="field" surfaceScale="3" diffuseConstant="1"
    lighting-color="#ffffff" result="lit">
    <feDistantLight data-p="lightDir" azimuth="135" elevation="52"/>
  </feDiffuseLighting>

  <feSpecularLighting data-p="specular" in="field" surfaceScale="3" specularConstant="0"
    specularExponent="26" lighting-color="#fffdf6" result="sheen">
    <feDistantLight data-p="sheenDir" azimuth="135" elevation="58"/>
  </feSpecularLighting>

  <feComposite data-p="sheenMix" in="sheen" in2="lit" operator="arithmetic"
    k1="0" k2="1" k3="1" k4="0" result="sheet"/>
  <!-- The lighting primitives write alpha 1 across the whole subregion; clipping
       to SourceGraphic's alpha keeps the sheet inside the layer it is drawn on. -->
  <feComposite in="sheet" in2="SourceGraphic" operator="in"/>
</filter>`;

/**
 * Soiling: dark where the sheet is *low*, so the map's luminance is inverted before
 * it becomes alpha, then curved so only the deep folds pick anything up.
 */
const SOIL_FILTER = `
<filter color-interpolation-filters="sRGB">
  <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="height"/>
  <feComponentTransfer in="height" result="valleys">
    <feFuncA type="table" tableValues="1 0"/>
  </feComponentTransfer>
  <feComponentTransfer in="valleys" result="shaped">
    <feFuncA data-p="soilGamma" type="gamma" amplitude="1" exponent="2.6" offset="0"/>
  </feComponentTransfer>
  <feFlood flood-color="#6b6152" result="dirt"/>
  <feComposite in="dirt" in2="shaped" operator="in"/>
</filter>`;

export function createCssCrumpleRenderer(
  stack: HTMLElement,
  initial: CrumpledConfig,
): CrumpledRendererInstance {
  const tone = document.createElement('div');
  tone.className = 'crumpled-paper-tone';
  const sheet = document.createElement('div');
  sheet.className = 'crumpled-paper-sheet';
  const sheen = document.createElement('div');
  sheen.className = 'crumpled-paper-sheen';
  const soil = document.createElement('div');
  soil.className = 'crumpled-paper-soil';
  const grain = document.createElement('div');
  grain.className = 'crumpled-paper-grain';
  stack.append(tone, sheet, sheen, soil, grain);

  const sheetFilter: FilterHandle = createFilter(SHEET_FILTER, 'crumpled-paper-sheet');
  const sheenFilter: FilterHandle = createFilter(SHEET_FILTER, 'crumpled-paper-sheen');
  const soilFilter: FilterHandle = createFilter(SOIL_FILTER, 'crumpled-paper-soil');
  sheet.style.filter = sheetFilter.css;
  sheen.style.filter = sheenFilter.css;
  soil.style.filter = soilFilter.css;

  let config = initial;
  let width = 0;
  let height = 0;
  let azimuth = config.light;
  let destroyed = false;

  function bakeHeightMap(): void {
    if (destroyed || width === 0 || height === 0) return;

    const fit = Math.min(1, MAP_MAX_PX / Math.max(width, height));
    const mapWidth = Math.max(1, Math.round(width * fit));
    const mapHeight = Math.max(1, Math.round(height * fit));

    const canvas = document.createElement('canvas');
    canvas.width = mapWidth;
    canvas.height = mapHeight;
    const context = canvas.getContext('2d');
    if (context === null) {
      console.warn('crumpled-paper: no 2D context, the sheet will stay flat.');
      return;
    }

    context.fillStyle = '#000';
    context.fillRect(0, 0, mapWidth, mapHeight);
    // Sum, not paint over: every crease contributes its own height.
    context.globalCompositeOperation = 'lighter';

    const shapes = buildCreases({
      width: mapWidth,
      height: mapHeight,
      scale: Math.max(24, config.scale) * fit,
      sharpness: config.creases,
      seed: config.seed,
    });

    for (const shape of shapes) {
      context.save();
      context.translate(shape.cx, shape.cy);
      context.rotate(shape.angle);
      // Unit circle in the scaled frame is the ellipse in the sheet's frame.
      context.scale(Math.max(shape.length, 0.5), Math.max(shape.reach, 0.5));

      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
      const peak = Math.round(clamp01(shape.amplitude) * 255);
      const shoulder = shape.kind === 'crease' ? 0.45 : 0.9;
      const mid = Math.round(clamp01(shape.amplitude) * (shape.kind === 'crease' ? 0.62 : 0.4) * 255);
      gradient.addColorStop(0, `rgb(${peak} ${peak} ${peak})`);
      gradient.addColorStop(shoulder, `rgb(${mid} ${mid} ${mid})`);
      gradient.addColorStop(1, 'rgb(0 0 0)');

      context.fillStyle = gradient;
      context.fillRect(-1, -1, 2, 2);
      context.restore();
    }

    const map = `url("${canvas.toDataURL('image/png')}")`;
    for (const layer of [sheet, sheen, soil]) layer.style.backgroundImage = map;
  }

  function pushLook(): void {
    const depth = clamp01(config.depth);
    // Diffuse shading follows the height field's gradient between *adjacent
    // pixels*, and a crease is only a few px across — so relief is tuned to the
    // crease's own width, not to the spacing between creases.
    const relief = 0.8 + depth * 4;

    sheetFilter.set('diffuse', { surfaceScale: relief.toFixed(2), diffuseConstant: 1 });
    sheetFilter.set('specular', { specularConstant: 0 });
    sheenFilter.set('diffuse', { surfaceScale: relief.toFixed(2), diffuseConstant: 0 });
    sheenFilter.set('specular', {
      surfaceScale: relief.toFixed(2),
      specularConstant: (clamp01(config.shine) * 1.6).toFixed(3),
      specularExponent: (14 + clamp01(config.creases) * 30).toFixed(1),
    });

    const fit = width === 0 ? 1 : Math.min(1, MAP_MAX_PX / Math.max(width, height));
    for (const filter of [sheetFilter, sheenFilter]) {
      filter.set('soften', { stdDeviation: (0.6 + 0.8 * fit).toFixed(2) });
    }

    // How much of the shading lands is layer opacity, not lighting gain: pushing
    // `diffuseConstant` instead blows the lit panels past white and flattens the
    // creases it is meant to deepen.
    sheet.style.opacity = lerp(0.25, 0.72, depth).toFixed(3);
    sheen.style.opacity = lerp(0.3, 0.95, clamp01(config.shine)).toFixed(3);

    soilFilter.set('soilGamma', { exponent: (1.8 + (1 - clamp01(config.soiling)) * 3.6).toFixed(2) });
    soil.style.opacity = (clamp01(config.soiling) * 0.55).toFixed(3);
    grain.style.opacity = (clamp01(config.grain) * 0.5).toFixed(3);
    tone.style.background = config.paperColor;
    tone.style.opacity = (clamp01(config.tone) * 0.55).toFixed(3);
  }

  function pushLight(): void {
    // Elevation stays put: a sheet lit from directly above loses its creases, and
    // the azimuth is the one value the scroll scrub moves.
    sheetFilter.set('lightDir', { azimuth: azimuth.toFixed(2), elevation: 52 });
    sheenFilter.set('sheenDir', { azimuth: azimuth.toFixed(2), elevation: 58 });
  }

  return {
    setOptions(next: CrumpledConfig): void {
      const previous = config;
      config = next;
      if (
        next.scale !== previous.scale ||
        next.creases !== previous.creases ||
        next.seed !== previous.seed
      ) {
        bakeHeightMap();
      }
      pushLook();
    },

    setLight(nextAzimuth: number): void {
      azimuth = nextAzimuth;
      pushLight();
    },

    resize(nextWidth: number, nextHeight: number): void {
      width = nextWidth;
      height = nextHeight;
      bakeHeightMap();
      pushLook();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      sheetFilter.destroy();
      sheenFilter.destroy();
      soilFilter.destroy();
      for (const layer of [tone, sheet, sheen, soil, grain]) layer.remove();
    },
  };
}

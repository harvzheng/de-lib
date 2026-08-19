/**
 * Single source of truth for what ships in the pack.
 * The gallery renders from this list; adding an effect means adding an entry.
 */

export type EffectCategory = 'transition' | 'background' | 'overlay' | 'annotation';
export type EffectTech = 'css' | 'svg' | 'canvas2d' | 'webgl';

export interface EffectMeta {
  /** Directory name under `src/effects/`, also the lib build output name. */
  slug: string;
  title: string;
  category: EffectCategory;
  /** One sentence, editor-pack voice: what it looks like, not how it works. */
  blurb: string;
  tech: EffectTech[];
  tags: string[];
  /** True when the effect is scrubbed by scroll position rather than by time. */
  scrollDriven: boolean;
  /** Demo page path, valid in both `vite dev` and the built site. */
  demo: string;
}

export const EFFECTS: EffectMeta[] = [
  {
    slug: 'film-burn-transition',
    title: 'Film Burn Transition',
    category: 'transition',
    blurb:
      'One shot burns away to reveal the next — amber ignition edge, charring, and blown-out highlights, scrubbed by scroll.',
    tech: ['webgl', 'svg', 'css'],
    tags: ['transition', 'burn', 'scroll', '16mm'],
    scrollDriven: true,
    demo: '/src/effects/film-burn-transition/demo.html',
  },
  {
    slug: 'film-grain-video',
    title: 'Filmstock Video Background',
    category: 'background',
    blurb:
      'Any video regraded as Kodak Gold 200 35mm: heavy moving grain, halation, gate weave, and a decimated frame rate for projector stutter.',
    tech: ['webgl', 'canvas2d', 'svg', 'css'],
    tags: ['background', 'grain', 'video', '35mm', 'kodak-gold'],
    scrollDriven: false,
    demo: '/src/effects/film-grain-video/demo.html',
  },
  {
    slug: 'film-burn-overlay',
    title: 'Film Burn Overlay',
    category: 'overlay',
    blurb:
      'A sustained burn-and-light-leak layer over an image: holes bloom open, embers crawl, and the frame breathes as you scroll through it.',
    tech: ['css', 'svg'],
    tags: ['overlay', 'burn', 'light-leak', 'scroll', 'parallax'],
    scrollDriven: true,
    demo: '/src/effects/film-burn-overlay/demo.html',
  },
  {
    slug: 'scribble-highlight',
    title: 'Scribble Highlight',
    category: 'annotation',
    blurb:
      'Hand-drawn scribbles that draw themselves around any element, boil frame-by-frame like rough animation, then flutter away.',
    tech: ['svg'],
    tags: ['annotation', 'hand-drawn', 'scribble', 'boil', 'scroll'],
    scrollDriven: true,
    demo: '/src/effects/scribble-highlight/demo.html',
  },
  {
    slug: 'light-leak-transition',
    title: 'Light Leak Transition',
    category: 'transition',
    blurb:
      'A light leak carries the cut between two shots — a blown-out white flash hiding the change inside the flare, or translucent red, amber, and magenta bands sweeping across as the next shot crossfades underneath.',
    tech: ['webgl', 'svg', 'css'],
    tags: ['transition', 'light-leak', 'scroll', 'film'],
    scrollDriven: true,
    demo: '/src/effects/light-leak-transition/demo.html',
  },
  {
    slug: 'particulate-dissolve',
    title: 'Particulate Dissolve',
    category: 'transition',
    blurb:
      'The target crumbles into drifting ash and blows away, scrubbed by scroll and fully reversible.',
    tech: ['webgl', 'svg', 'canvas2d', 'css'],
    tags: ['transition', 'dissolve', 'particles', 'scroll', 'ash'],
    scrollDriven: true,
    demo: '/src/effects/particulate-dissolve/demo.html',
  },
  {
    slug: 'subway-motion',
    title: 'Subway Motion',
    category: 'overlay',
    blurb:
      'A night train passing — tunnel lights streak past dark carriage glass, or a lit train sweeps across the foreground with windows strobing by.',
    tech: ['css', 'svg'],
    tags: ['overlay', 'motion', 'train', 'night'],
    scrollDriven: false,
    demo: '/src/effects/subway-motion/demo.html',
  },
  {
    slug: 'comic-print',
    title: 'Comic Print',
    category: 'overlay',
    blurb:
      'Newsprint comic reproduction over any content: angled halftone dots, a posterised limited palette, ink misregistration, and paper grain.',
    tech: ['css', 'svg'],
    tags: ['overlay', 'comic', 'halftone', 'print'],
    scrollDriven: false,
    demo: '/src/effects/comic-print/demo.html',
  },
  {
    slug: 'bokeh',
    title: 'Bokeh',
    category: 'overlay',
    blurb:
      'Defocused highlights sitting on the bright points of your own picture, each in that point\'s colour, shimmering as the reader scrolls.',
    tech: ['webgl', 'css'],
    tags: ['overlay', 'bokeh', 'lens', 'scroll', 'content-aware'],
    scrollDriven: true,
    demo: '/src/effects/bokeh/demo.html',
  },
  {
    slug: 'comic-impact',
    title: 'Comic Impact',
    category: 'annotation',
    blurb:
      'A hand-inked starburst, speed lines, and an offset outline pop in behind your own text for the POW beat, then shake and exit.',
    tech: ['svg', 'css'],
    tags: ['annotation', 'comic', 'impact', 'scroll'],
    scrollDriven: true,
    demo: '/src/effects/comic-impact/demo.html',
  },
  {
    slug: 'ripped-page',
    title: 'Ripped Page',
    category: 'transition',
    blurb:
      'The shot on screen is a printed page: it tears across, the fibres let go, and the halves pull apart to reveal the next one.',
    tech: ['svg', 'css'],
    tags: ['transition', 'paper', 'tear', 'scroll'],
    scrollDriven: true,
    demo: '/src/effects/ripped-page/demo.html',
  },
  {
    slug: 'crumpled-paper',
    title: 'Crumpled Paper',
    category: 'overlay',
    blurb:
      'Your content printed on a sheet that was screwed up and flattened out again — irregular panels, creases where they meet, fibre tooth.',
    tech: ['webgl', 'svg', 'canvas2d', 'css'],
    tags: ['overlay', 'paper', 'texture', 'lighting'],
    scrollDriven: false,
    demo: '/src/effects/crumpled-paper/demo.html',
  },
  {
    slug: 'wiggly-text',
    title: 'Wiggly Text',
    category: 'annotation',
    blurb:
      'Type that will not sit still — a hand redrawing the same line a few times a second, on any font, any size, any script.',
    tech: ['svg', 'css'],
    tags: ['annotation', 'text', 'wiggle', 'hand-drawn'],
    scrollDriven: false,
    demo: '/src/effects/wiggly-text/demo.html',
  },
  {
    slug: 'street-light',
    title: 'Street Light',
    category: 'overlay',
    blurb:
      'One lamp on a mast, standing still while the page walks underneath: whatever is under the pool is lit warm and hard, and the rest of the street is cold and dark.',
    tech: ['css'],
    tags: ['overlay', 'light', 'night', 'scroll'],
    scrollDriven: true,
    demo: '/src/effects/street-light/demo.html',
  },
  {
    slug: 'neon-sign',
    title: 'Neon Sign',
    category: 'overlay',
    blurb:
      'Your own heading, wired to the mains: a hot glass core inside a gas halo, buzzing and dropping out, pooling its light on whatever is behind it.',
    tech: ['css'],
    tags: ['overlay', 'text', 'glow', 'night'],
    scrollDriven: false,
    demo: '/src/effects/neon-sign/demo.html',
  },
];

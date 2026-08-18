/**
 * SVG filter plumbing for the CSS-side effects. A filter is authored as a
 * markup template string and animated by writing attributes on its primitives
 * every frame: CSS properties cannot reach inside a filter, and SMIL animation
 * of filter primitives is not portable, so per-frame attribute writes on the
 * primitives are the supported way to animate them.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface FilterHandle {
  readonly id: string;
  /** `url(#id)` — ready to assign to a CSS `filter` value. */
  readonly css: string;
  readonly element: SVGFilterElement;
  /**
   * Updates attributes on the primitive tagged `data-p="name"` in the markup.
   * Throws when no such primitive exists — a typo is otherwise silent.
   */
  set(name: string, attributes: Record<string, string | number>): void;
  destroy(): void;
}

let host: SVGSVGElement | undefined;
let hostDefs: SVGDefsElement | undefined;
let liveFilters = 0;
let sequence = 0;

function acquireDefs(): SVGDefsElement {
  if (hostDefs !== undefined) return hostDefs;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  // `display: none` stops some engines from resolving the filters referenced
  // from it, so the host has to stay rendered while occupying nothing.
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.overflow = 'hidden';

  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);

  host = svg;
  hostDefs = defs;
  return defs;
}

function releaseDefs(): void {
  liveFilters -= 1;
  if (liveFilters > 0 || host === undefined) return;
  host.remove();
  host = undefined;
  hostDefs = undefined;
}

/**
 * Parses an SVG `<filter>` fragment, assigns it a unique id derived from
 * `idPrefix`, appends it to a single shared hidden `<svg><defs>` host in
 * `document.body`, and returns a live handle. Any `id` in the markup is
 * replaced. The host is created on first use and removed with the last filter.
 */
export function createFilter(markup: string, idPrefix: string): FilterHandle {
  // The wrapping root carries the namespace so primitives parse as SVG rather
  // than as unknown elements.
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${markup}</svg>`,
    'image/svg+xml',
  );
  if (parsed.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`createFilter: markup is not well-formed XML\n${markup}`);
  }

  const source = parsed.documentElement.querySelector('filter');
  if (source === null) {
    throw new Error(`createFilter: markup contains no <filter> element\n${markup}`);
  }

  sequence += 1;
  const id = `${idPrefix}-${sequence.toString(36)}`;
  const element = document.importNode(source, true) as SVGFilterElement;
  element.id = id;

  // Resolved once: `set` runs per frame and must not query the DOM.
  const primitives = new Map<string, Element>();
  for (const node of element.querySelectorAll('[data-p]')) {
    const name = node.getAttribute('data-p');
    if (name !== null) primitives.set(name, node);
  }

  acquireDefs().appendChild(element);
  liveFilters += 1;

  let destroyed = false;

  return {
    id,
    css: `url(#${id})`,
    element,

    set(name: string, attributes: Record<string, string | number>): void {
      const primitive = primitives.get(name);
      if (primitive === undefined) {
        throw new Error(`Filter ${id} has no primitive tagged data-p="${name}"`);
      }
      for (const attribute in attributes) {
        primitive.setAttribute(attribute, String(attributes[attribute]));
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      element.remove();
      primitives.clear();
      releaseDefs();
    },
  };
}

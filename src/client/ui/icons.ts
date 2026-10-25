// Small inline SVG icons built with createElementNS (no HTML strings). They
// are decorative and always sit next to a text label (PRD 7.4), so they are
// hidden from assistive technology.

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWBOX = '0 0 24 24';

function svg(className: string, ...children: SVGElement[]): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', VIEWBOX);
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  root.setAttribute('class', `icon ${className}`);
  root.append(...children);
  return root;
}

function shape(tag: string, attrs: Readonly<Record<string, string>>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

const FILLED = { fill: 'currentColor' } as const;
const STROKED = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

// Pilot role icon: a curved arrow turning right.
export function steeringArrowIcon(): SVGSVGElement {
  return svg(
    'icon-steer',
    shape('path', { ...STROKED, d: 'M5 19V12a6 6 0 0 1 6-6h7' }),
    shape('path', { ...STROKED, d: 'M15 3l3 3-3 3' }),
  );
}

// Engineer role icon.
export function lightningBoltIcon(): SVGSVGElement {
  return svg('icon-bolt', shape('path', { ...FILLED, d: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z' }));
}

export function lockIcon(): SVGSVGElement {
  return svg(
    'icon-lock',
    shape('rect', { ...STROKED, x: '5', y: '11', width: '14', height: '10', rx: '2' }),
    shape('path', { ...STROKED, d: 'M8 11V8a4 4 0 0 1 8 0v3' }),
  );
}

// Team Comet glyph (▲), drawn so it renders the same on every font stack.
export function cometGlyphIcon(): SVGSVGElement {
  return svg('icon-glyph', shape('path', { ...FILLED, d: 'M12 4l9 16H3z' }));
}

// Team Nova glyph (●).
export function novaGlyphIcon(): SVGSVGElement {
  return svg('icon-glyph', shape('circle', { ...FILLED, cx: '12', cy: '12', r: '8' }));
}

export function checkIcon(): SVGSVGElement {
  return svg('icon-check', shape('path', { ...STROKED, 'stroke-width': '3', d: 'M5 12l5 5 9-10' }));
}

export function boostIcon(): SVGSVGElement {
  return svg(
    'icon-boost',
    shape('path', { ...STROKED, d: 'M6 13l6-6 6 6' }),
    shape('path', { ...STROKED, d: 'M6 19l6-6 6 6' }),
  );
}

export function shieldIcon(): SVGSVGElement {
  return svg('icon-shield', shape('path', { ...STROKED, d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' }));
}

// Progress ring. pathLength=1 lets CSS drive the fill with a 0..1 custom
// property instead of computing the circumference.
export function progressRing(className: string): SVGSVGElement {
  return svg(
    `ring ${className}`,
    shape('circle', { class: 'ring-track', cx: '12', cy: '12', r: '10', fill: 'none' }),
    shape('circle', { class: 'ring-fill', cx: '12', cy: '12', r: '10', fill: 'none', pathLength: '1' }),
  );
}

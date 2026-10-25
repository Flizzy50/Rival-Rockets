import qrcode from 'qrcode-generator';

// QR code for the share link (Requirement 3.5): generated on the device and
// drawn as SVG nodes, never as an HTML string. Dark modules on a light
// background, because phone camera scanners expect that contrast.

const SVG_NS = 'http://www.w3.org/2000/svg';
// Four modules of quiet zone is the QR standard minimum.
const QUIET_ZONE = 4;
// Medium error correction survives a glare spot on a phone screen.
const ERROR_CORRECTION = 'M';
const AUTO_SIZE = 0;

export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(AUTO_SIZE, ERROR_CORRECTION);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, col) => qr.isDark(row, col)));
}

export function createQrSvg(text: string, label: string): SVGSVGElement {
  const matrix = qrMatrix(text);
  const size = matrix.length + QUIET_ZONE * 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'qr');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  // Crisp module edges at any scale.
  svg.setAttribute('shape-rendering', 'crispEdges');

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('class', 'qr-bg');
  background.setAttribute('width', String(size));
  background.setAttribute('height', String(size));
  svg.append(background);

  // One path keeps the node count small: a 6-character room link is a few
  // hundred dark modules.
  let d = '';
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    });
  });
  const modules = document.createElementNS(SVG_NS, 'path');
  modules.setAttribute('class', 'qr-fg');
  modules.setAttribute('d', d);
  svg.append(modules);
  return svg;
}

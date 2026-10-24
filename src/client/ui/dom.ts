// Tiny DOM builder. Text is only ever set through textContent so nothing a
// player or browser supplies can be parsed as HTML (AGENTS.md security rules).

export interface ElementOptions {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

export function button(text: string, className: string, onClick: () => void, ...children: Node[]): HTMLButtonElement {
  const node = el('button', { className, attrs: { type: 'button' } }, ...children);
  if (text) node.append(el('span', { className: 'btn-label', text }));
  node.addEventListener('click', onClick);
  return node;
}

// Per-frame updates write only when the value changes, so the rAF loop does
// not cause needless style and layout work.
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setVar(node: HTMLElement | SVGElement, name: string, value: number): void {
  const text = String(value);
  if (node.style.getPropertyValue(name) !== text) node.style.setProperty(name, text);
}

// Restarts a one-shot CSS animation class even if it is already applied.
export function replayClass(node: Element, className: string): void {
  node.classList.remove(className);
  // Reading layout forces the browser to drop the old animation first.
  void (node as HTMLElement).offsetWidth;
  node.classList.add(className);
}

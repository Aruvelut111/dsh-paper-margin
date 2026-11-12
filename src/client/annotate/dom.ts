/** Native DOM for imperative overlays. React elements belong only in host slots. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'style') Object.assign(node.style, value)
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    else if (key in node && !key.startsWith('aria-') && !key.startsWith('data-')) (node as unknown as Record<string, unknown>)[key] = value
    else if (value !== undefined && value !== false) node.setAttribute(key, String(value))
  }
  for (const child of children) if (child !== null) node.append(child)
  return node
}

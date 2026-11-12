/** DSH retains sidebar DOM while collapsed and while another session is selected. */
export function readerSurfaceVisible(root: Element): boolean {
  if (!root.isConnected) return false
  for (let element: Element | null = root; element; element = element.parentElement) {
    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return false
    if (element.hasAttribute('data-sidebar-right-panel') && !element.hasAttribute('data-sidebar-right-open') && !root.closest('[data-dockkit-float]')) return false
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  }
  return true
}
export function readerSessionId(root: Element): string | undefined {
  // A side conversation lives inside its parent's sidebar. Its own session
  // owns selections; the outer sidebar identifies only the hosting layout.
  const owner = root.closest('[data-sidenote-chat-session], [data-conversation-session], [data-sidebar-right-session]')
  return owner?.getAttribute('data-sidenote-chat-session') || owner?.getAttribute('data-conversation-session') || owner?.getAttribute('data-sidebar-right-session') || undefined
}
export const READER_VISIBILITY_ATTRIBUTES = ['hidden', 'aria-hidden', 'class', 'style', 'data-sidebar-right-open', 'data-sidebar-right-session', 'data-conversation-session', 'data-sidenote-chat-session']

/** Text layers can add thousands of descendants. Only the ancestor chain can
 * hide a reader; watching its descendants also observes our own toolbar writes. */
export function observeReaderVisibility(root: Element, changed: () => void): () => void {
  let parents: Element[] = []
  const chain = () => { const next: Element[] = []; for (let node: Element | null = root; node; node = node.parentElement) next.push(node); return next }
  const bind = (next: Element[]) => {
    observer.disconnect(); parents = next
    for (const node of parents) observer.observe(node, { attributes: true, attributeFilter: READER_VISIBILITY_ATTRIBUTES, childList: true })
  }
  const observer = new MutationObserver(records => {
    const next = chain()
    const moved = next.length !== parents.length || next.some((node, index) => node !== parents[index])
    if (moved) bind(next)
    if (moved || records.some(record => record.type === 'attributes')) changed()
  })
  bind(chain())
  return () => observer.disconnect()
}

/** Discover viewer mounts without querying the entire document for every PDF span. */
export function observeReaderRoots(selector: string, scan: () => void): () => void {
  let frame = 0; let stopped = false
  const contains = (node: Node) => node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null)
  const observer = new MutationObserver(records => {
    if (!records.some(record => [...record.addedNodes, ...record.removedNodes].some(contains))) return
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!stopped) scan() })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => { stopped = true; observer.disconnect(); if (frame) cancelAnimationFrame(frame) }
}

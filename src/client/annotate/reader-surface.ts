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
  return root.closest('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session') || root.closest('[data-conversation-session]')?.getAttribute('data-conversation-session') || undefined
}
export const READER_VISIBILITY_ATTRIBUTES = ['hidden', 'aria-hidden', 'class', 'style', 'data-sidebar-right-open', 'data-sidebar-right-session', 'data-conversation-session']

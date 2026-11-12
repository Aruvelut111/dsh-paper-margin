/**
 * Selection capture + annotation toolbar over the pdf.js text layer.
 *
 * Lives next to the PdfView instance: listens for text selections inside the
 * page stack, shows a small toolbar near the selection, and hands clean
 * {quote, page, rects} triples to the annotation store. No react here — the
 * body component owns one and this attaches to its DOM.
 */
import { cleanSelection } from '../annotate/model'
import { openInlineEditor } from './editor'
import { readerSurfaceVisible, READER_VISIBILITY_ATTRIBUTES } from './reader-surface'

export interface SelectionCapture {
  pageAtPoint(x: number, y: number): number | null
  rectsForSelection(selection: Selection): { x: number; y: number; w: number; h: number }[]
}

interface SelectionHandlers {
  onAnnotate(payload: { page: number; quote: string; rects: { x: number; y: number; w: number; h: number }[]; point: { x: number; y: number } }): { update(note: string): void } | void
}

export function attachSelectionCapture(
  root: HTMLElement,
  capture: SelectionCapture,
  handlers: SelectionHandlers,
): () => void {
  const toolbar = document.createElement('div')
  toolbar.setAttribute('data-paper-margin-toolbar', '')
  Object.assign(toolbar.style, {
    position: 'fixed',
    display: 'none',
    zIndex: '50',
    background: 'var(--dsw-alias-bg-layer-3, #fff)',
    border: '0.5px solid var(--dsw-alias-border-l2, #ccc)',
    borderRadius: '6px',
    boxShadow: '0 2px 8px rgba(0,0,0,.15)',
    padding: '2px',
  } as CSSStyleDeclaration)
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '添加到对话'
  button.setAttribute('data-paper-margin-annotate', '')
  Object.assign(button.style, {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '12px',
    padding: '4px 10px',
    borderRadius: '4px',
    color: 'var(--dsw-alias-label-primary, inherit)',
  } as CSSStyleDeclaration)
  toolbar.appendChild(button)
  document.body.appendChild(toolbar)

  let current: { page: number; quote: string; rects: { x: number; y: number; w: number; h: number }[]; anchorX: number; anchorY: number } | null = null
  let closeEditor: (() => void) | undefined

  const onMouseUp = (): void => {
    current = null
    toolbar.style.display = 'none'
    const selection = document.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer) || !readerSurfaceVisible(root)) return
    const text = selection.toString()
    if (text.length === 0) return
    const quote = cleanSelection(text)
    if (quote === '') return
    const firstRect = range.getBoundingClientRect()
    const page = capture.pageAtPoint(firstRect.left, firstRect.top)
    if (page === null) return
    current = {
      page,
      quote,
      rects: capture.rectsForSelection(selection),
      anchorX: firstRect.left,
      anchorY: firstRect.bottom,
    }
    toolbar.style.display = 'block'
    toolbar.style.left = `${Math.max(8, Math.min(window.innerWidth - toolbar.offsetWidth - 8, current.anchorX))}px`
    toolbar.style.top = `${Math.max(8, Math.min(window.innerHeight - toolbar.offsetHeight - 8, current.anchorY + 6))}px`
  }

  const onButtonDown = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    if (current === null || !readerSurfaceVisible(root)) return
    try {
      const selected = current
      const handle = handlers.onAnnotate({ page: selected.page, quote: selected.quote, rects: selected.rects, point: { x: selected.anchorX, y: selected.anchorY } })
      if (handle) closeEditor = openInlineEditor({ quote: selected.quote, x: selected.anchorX, y: selected.anchorY, draft: handle.update, save: handle.update })
    } catch (error) { console.error('[dsh-paper-margin] annotation failed', error); return }
    document.getSelection()?.removeAllRanges()
    toolbar.style.display = 'none'
    current = null
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      toolbar.style.display = 'none'
      current = null
    }
  }

  document.addEventListener('mouseup', onMouseUp, true)
  button.addEventListener('mousedown', onButtonDown)
  const onKeyboardClick = (event: MouseEvent) => { if (event.detail === 0) onButtonDown(event) }
  button.addEventListener('click', onKeyboardClick)
  const onScroll = () => { toolbar.style.display = 'none'; current = null }
  window.addEventListener('scroll', onScroll, true)
  document.addEventListener('keydown', onKey, true)
  const visibility = new MutationObserver(() => { if (!readerSurfaceVisible(root)) onScroll() })
  visibility.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: READER_VISIBILITY_ATTRIBUTES })
  return () => {
    closeEditor?.()
    visibility.disconnect()
    document.removeEventListener('mouseup', onMouseUp, true)
    button.removeEventListener('mousedown', onButtonDown)
    button.removeEventListener('click', onKeyboardClick)
    window.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('keydown', onKey, true)
    toolbar.remove()
  }
}

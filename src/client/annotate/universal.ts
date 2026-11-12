/**
 * Universal selection annotator: one toolbar for every selectable surface the
 * sidebar and the chat render — file previews (text/markdown/code/diff),
 * diff views, code blocks, the terminal, and this plugin's own PDF text layer.
 *
 * Why a document-level layer instead of per-view wiring: the host mounts each
 * surface independently and many are plain server-rendered text nodes (Markdown
 * output, diff rows). A single capture listener that classifies the selection's
 * container by its `data-*` attribute covers all of them, new ones included,
 * without touching host internals or racing other plugins' listeners.
 *
 * Other plugins also listen for selections (sidenote, dsh-client-ui-quote). We
 * never consume the selection or stop propagation: our toolbar is an extra
 * affordance, and their浮层 behavior is untouched.
 */

/** Containers whose text is worth annotating, most specific first.
 *
 * The plugin's own PDF page is deliberately NOT here: the PDF reader installs
 * its own capture (annotate/selection.ts) that writes to the address-keyed
 * store the reader's panel reads. Listing it again produced two toolbars over
 * one selection, and the universal one wrote to a surface key nothing renders. */
const SOURCE_SELECTORS: ReadonlyArray<{ selector: string; kind: string }> = [
  { selector: '[data-document-markdown]', kind: 'markdown' },
  { selector: '[data-pdf-preview]', kind: 'office' },
  { selector: '[data-excel-preview]', kind: 'excel' },
  { selector: '[data-diff-code]', kind: 'diff' },
  { selector: '[data-code-block-content]', kind: 'code' },
  { selector: '[data-textpreview-body]', kind: 'file' },
  { selector: '[data-markdown-variant]', kind: 'markdown' },
  { selector: '[data-terminal]', kind: 'terminal' },
  { selector: '[data-conversation-content]', kind: 'chat' },
]

import { openInlineEditor } from './editor'
import { captureTextAnchor, type TextAnchor } from './text-anchor'
import { readerSessionId, readerSurfaceVisible, observeReaderVisibility } from './reader-surface'

export interface CapturedSelection {
  anchor?: TextAnchor
  point?: { x: number; y: number }
  note?: string
  id?: string
  sessionId?: string
  file?: string
  sourceAddress?: string
  /** Which surface produced the selection. */
  kind: string
  /** The quoted text, cleaned. */
  quote: string
  /** Page number when the surface is this plugin's PDF reader. */
  page?: number
  /** A short human label for the panel, e.g. "diff 第 5 行" or "p.7". */
  where: string
  /** 1-based first line inside the container, when derivable. */
  line?: number
}

export interface UniversalAnnotatorOptions {
  /** Called when the user commits a selection as an annotation.
   * @returns a short confirmation line shown under the button, or undefined. */
  onAnnotate(captured: CapturedSelection): string | { message?: string; update(note: string): void } | undefined
}

/**
 * Install the document-level annotator.
 * @returns a disposer removing every listener, node and observer it added.
 */
export function attachUniversalAnnotator(options: UniversalAnnotatorOptions): () => void {
  if (typeof document === 'undefined') return () => undefined

  const toolbar = document.createElement('div')
  toolbar.setAttribute('data-paper-margin-toolbar', '')
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', '添加到对话')
  Object.assign(toolbar.style, {
    position: 'fixed',
    display: 'none',
    zIndex: '2147483000',
    background: 'var(--dsw-alias-bg-layer-3, #fff)',
    border: '0.5px solid var(--dsw-alias-border-l2, #ccc)',
    borderRadius: '7px',
    boxShadow: '0 4px 14px rgba(0,0,0,.16)',
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
    lineHeight: '1.4',
    padding: '5px 11px',
    borderRadius: '5px',
    color: 'var(--dsw-alias-label-primary, inherit)',
    whiteSpace: 'nowrap',
  } as CSSStyleDeclaration)
  toolbar.appendChild(button)

  // Transient confirmation, so a committed annotation never looks like a no-op
  // even when the surface has no side panel of its own.
  const toast = document.createElement('div')
  toast.setAttribute('data-paper-margin-toast', '')
  toast.setAttribute('role', 'status')
  Object.assign(toast.style, {
    position: 'fixed',
    display: 'none',
    zIndex: '2147483000',
    maxWidth: '360px',
    padding: '7px 12px',
    borderRadius: '7px',
    fontSize: '12px',
    lineHeight: '1.5',
    background: 'var(--dsw-alias-bg-layer-3, #1f2124)',
    color: 'var(--dsw-alias-label-primary, #fff)',
    border: '0.5px solid var(--dsw-alias-border-l2, #444)',
    boxShadow: '0 4px 14px rgba(0,0,0,.18)',
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  document.body.appendChild(toast)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  const say = (text: string, anchor: DOMRect): void => {
    if (text === '') return
    toast.textContent = text
    toast.style.display = 'block'
    const maxLeft = window.innerWidth - toast.offsetWidth - 8
    const below = anchor.bottom + 8
    const above = anchor.top - toast.offsetHeight - 8
    toast.style.left = `${Math.max(8, Math.min(anchor.left, maxLeft))}px`
    toast.style.top = `${below + toast.offsetHeight > window.innerHeight && above > 0 ? above : below}px`
    if (toastTimer !== undefined) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.style.display = 'none' }, 2600)
  }
  document.body.appendChild(toolbar)

  let pending: CapturedSelection | null = null
  let pendingSurface: Element | undefined
  let closeEditor: (() => void) | undefined
  let stopVisibility: (() => void) | undefined

  const hide = (): void => {
    if (toolbar.style.display !== 'none') toolbar.style.display = 'none'
    pending = null
    pendingSurface = undefined
    stopVisibility?.(); stopVisibility = undefined
  }

  /** Walk up from the selection to the nearest known surface container. */
  function surfaceOf(node: Node): { element: Element; kind: string } | undefined {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
    if (element === null) return undefined
    // Sidenote owns side-chat selection, anchors and the child composer. Never
    // reinterpret its reply as an external file belonging to the parent pane.
    if (element.closest('[data-sidenote-chat-session]')) return undefined
    if (element.closest('[data-paper-margin], [data-paper-margin-editor], [data-paper-margin-panel], [data-paper-margin-notebook], [data-dsh-sidenote], input, textarea, [contenteditable]')) return undefined
    if (document.querySelector('[data-dsh-sidenote]') && element.closest('[data-conversation-content]') && !element.closest('[data-textpreview-body]')) return undefined
    for (const { selector, kind } of SOURCE_SELECTORS) {
      const found = element.closest(selector)
      if (found !== null) return { element: found, kind }
    }
    return undefined
  }

  /** First line number of the selection within its container, when the DOM
   * makes it derivable (diff rows carry a line number attribute). */
  function lineOf(range: Range, container: Element): number | undefined {
    const row = (range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement)?.closest('[data-diff-line], [data-line], [data-textpreview-line], li')
    if (row === null || row === undefined) return undefined
    const raw = row.getAttribute('data-diff-line') ?? row.getAttribute('data-line') ?? row.getAttribute('data-textpreview-line')
    const parsed = raw === null ? Number.NaN : Number(raw)
    if (Number.isFinite(parsed)) return parsed
    const li = row as HTMLElement
    if (li.parentElement !== null && li.tagName === 'LI') {
      return [...li.parentElement.children].indexOf(li) + 1
    }
    void container
    return undefined
  }

  const onMouseUp = (event: MouseEvent): void => {
    // Right-click and middle-click keep their native meaning.
    if (event.button !== 0) return
    // Let the browser finish updating the selection for this gesture.
    queueMicrotask(() => {
      const selection = document.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
        hide()
        return
      }
      const range = selection.getRangeAt(0)
      const surface = surfaceOf(range.commonAncestorContainer)
      if (surface === undefined) {
        hide()
        return
      }
      const text = selection.toString()
      if (!readerSurfaceVisible(surface.element)) { hide(); return }
      if (text.trim() === '') {
        hide()
        return
      }
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        hide()
        return
      }
      const line = lineOf(range, surface.element)
      // No page numbers here: this layer deliberately excludes the plugin's own
      // PDF pages, which the reader's own capture handles with page awareness.
      const page = Number((range.startContainer.parentElement?.closest('[data-pdf-page]') as HTMLElement | null)?.dataset.pdfPage)
      const where = page > 0 ? 'p.' + page : line !== undefined ? `第 ${line} 行` : LABELS[surface.kind] ?? ''
      pending = {
        anchor: captureTextAnchor(surface.element.closest('[data-textpreview-url]') ?? surface.element, range),
        kind: surface.kind,
        ...(page > 0 ? { page } : {}),
        quote: text,
        ...sourceInfo(surface.element),
        sessionId: readerSessionId(surface.element),
        ...(line !== undefined ? { line } : {}),
        where,
      }
      toolbar.style.display = 'block'
      pendingSurface = surface.element
      stopVisibility?.()
      stopVisibility = observeReaderVisibility(surface.element, () => {
        if (!readerSurfaceVisible(surface.element) || readerSessionId(surface.element) !== pending?.sessionId) hide()
      })
      // Keep the toolbar fully on screen without covering the selection.
      const maxLeft = window.innerWidth - toolbar.offsetWidth - 8
      const below = rect.bottom + 6
      const above = rect.top - toolbar.offsetHeight - 6
      toolbar.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`
      toolbar.style.top = `${below + toolbar.offsetHeight > window.innerHeight && above > 0 ? above : below}px`
    })
  }

  const onButtonDown = (event: Event): void => {
    // mousedown, not click: the selection must still be live when we read it.
    event.preventDefault()
    event.stopPropagation()
    if (pending === null) return
    if (!pendingSurface || !readerSurfaceVisible(pendingSurface) || readerSessionId(pendingSurface) !== pending.sessionId) { hide(); return }
    const captured = pending
    const anchor = toolbar.getBoundingClientRect()
    captured.point = { x: anchor.left, y: anchor.bottom }
    let confirmation: string | undefined
    try {
      const handle = options.onAnnotate(captured)
      if (typeof handle === 'object') {
        confirmation = handle.message
        closeEditor = openInlineEditor({ quote: captured.quote, x: anchor.left, y: anchor.bottom, draft: handle.update, save: handle.update })
      } else confirmation = handle
    } catch (error) {
      confirmation = `批注失败：${error instanceof Error ? error.message : String(error)}`
    }
    document.getSelection()?.removeAllRanges()
    hide()
    if (confirmation !== undefined) say(confirmation, anchor)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') hide()
  }
  const onKeyboardClick = (event: MouseEvent): void => { if (event.detail === 0) onButtonDown(event) }
  const onKeyboardSelection = (event: KeyboardEvent): void => {
    if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) onMouseUp({ button: 0 } as MouseEvent)
  }

  const onScroll = (): void => hide()

  document.addEventListener('mouseup', onMouseUp, true)
  document.addEventListener('keyup', onKeyboardSelection, true)
  button.addEventListener('mousedown', onButtonDown)
  button.addEventListener('click', onKeyboardClick)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('scroll', onScroll, true)

  return () => {
    closeEditor?.()
    stopVisibility?.()
    document.removeEventListener('mouseup', onMouseUp, true)
    document.removeEventListener('keyup', onKeyboardSelection, true)
    button.removeEventListener('mousedown', onButtonDown)
    button.removeEventListener('click', onKeyboardClick)
    document.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('scroll', onScroll, true)
    if (toastTimer !== undefined) clearTimeout(toastTimer)
    toolbar.remove()
    toast.remove()
  }
}

const LABELS: Record<string, string> = {
  diff: 'diff',
  code: '代码',
  file: '文件',
  markdown: '文档',
  terminal: '终端',
  chat: '对话',
  pdf: 'PDF',
}

/** Keep the host's resource identity with each selection. */
export function sourceInfo(surface: Element): { file?: string; sourceAddress?: string } {
  const frame = surface.closest('[data-textpreview-url]')
  const image = surface instanceof HTMLImageElement ? surface : undefined
  const sourceAddress = frame?.getAttribute('data-textpreview-url') ?? image?.currentSrc ?? image?.src ?? undefined
  const path = frame?.querySelector('[data-textpreview-path]')?.textContent?.trim()
  const title = path?.split(String.fromCharCode(92)).join('/').split('/').pop()
  return { ...(sourceAddress ? { sourceAddress } : {}), ...(title ? { file: title } : {}) }
}

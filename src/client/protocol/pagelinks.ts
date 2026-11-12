/**
 * Citation links in chat replies: [main.pdf p.7 "exact words"] become
 * highlighted jumps into the open PDF view (CSS Custom Highlight API, with a
 * click handler that locates the words and flashes them).
 *
 * Performance discipline ported from cite-lens: only citations near the
 * viewport are painted, repainted on scroll settle, capped at 160 ranges.
 */
import { findPageCitations } from '../protocol/textsearch'
import type { PdfViewRegistry } from '../viewer/registry'

export const HIGHLIGHT = 'dsh-paper-margin-cite'

interface Citation {
  range: Range
  node: Text
  file?: string
  page?: number
  quote?: string
}

/** Scan one text node for citations. */
function scanNode(node: Text): Citation[] {
  const value = node.nodeValue ?? ''
  if (value.length < 4 || !value.includes('[')) return []
  return findPageCitations(value).map((hit) => {
    const range = document.createRange()
    range.setStart(node, hit.index)
    range.setEnd(node, hit.index + hit.length)
    return { range, node, file: hit.file, page: hit.page, quote: hit.quote } as Citation
  })
}

export function scanCitations(root: HTMLElement): Citation[] {
  const out: Citation[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current !== null) {
    if ((current as Text).data !== undefined) out.push(...scanNode(current as Text))
    current = walker.nextNode()
  }
  return out
}

/** Follow one citation: open/reveal the PDF, find the words, flash them. */
export async function followCitation(
  cite: { file?: string; page?: number; quote?: string },
  registry: PdfViewRegistry,
  opts: {
    open(address: string): boolean
    notify(message: string): void
  },
): Promise<void> {
  const entry = cite.file !== undefined ? registry.find(cite.file) : registry.latest()
  if (entry === undefined) {
    if (cite.file !== undefined) {
      const address = registry.addressFor(cite.file)
      if (address === undefined || !opts.open(address)) {
        opts.notify(`无法打开 ${cite.file}——先在文件树中打开一次，或确认路径`)
        return
      }
      const waited = await registry.waitFor(cite.file)
      if (waited === undefined) {
        opts.notify(`无法打开 ${cite.file}——检查路径`)
        return
      }
      return followCitation(cite, registry, opts)
    }
    const last = registry.lastOpened()
    if (last === undefined) {
      opts.notify('先打开一个 PDF，或用 [文件.pdf p.7] 的格式引用')
      return
    }
    return followCitation(cite, registry, opts)
  }
  const view = entry.view
  if (cite.quote !== undefined && cite.quote !== '') {
    const found = await view.locate(cite.quote, cite.page)
    if (found !== null) {
      view.reveal(found.page, found.boxes)
      return
    }
    if (cite.page !== undefined) view.reveal(cite.page, [])
    opts.notify(`"${cite.quote.slice(0, 45)}${cite.quote.length > 48 ? '…' : ''}" 不在 ${entry.file} 里${cite.page !== undefined ? `（已显示第 ${cite.page} 页）` : ''}——若刚改过源文件，需重新编译 PDF`)
    return
  }
  if (cite.page !== undefined) {
    if (cite.page > view.numPages) {
      opts.notify(`${entry.file} 共 ${view.numPages} 页，没有第 ${cite.page} 页`)
      return
    }
    view.reveal(cite.page, [])
  }
}

/** The conversation transcript root, or the document body as a fallback.
 * The real attribute is `data-conversation-content` (the scrolling port is
 * `data-conversation-scroll`); scanning the whole body when neither is up yet
 * keeps citations working during the first render.
 *
 * Scope matters for correctness, not just cost: a body-wide scan also matches
 * bracketed page references inside a PDF's own text or a code block, turning
 * ordinary prose into bogus jump targets. */
function chatRootOf(doc: Document): HTMLElement {
  const content = doc.querySelector('[data-conversation-content]')
  if (content !== null) return content as HTMLElement
  const scroll = doc.querySelector('[data-conversation-scroll]')
  if (scroll !== null) return scroll as HTMLElement
  return doc.body
}

/** Paint citations near the viewport; install click handling. */
export function installPageLinks(
  registry: PdfViewRegistry,
  doc: Document = document,
  opts: { open(address: string): boolean; notify(message: string): void },
): () => void {
  const win = doc.defaultView
  const highlights = win?.CSS?.highlights
  const HighlightCtor = win?.Highlight

  let citations: Citation[] = []
  let painted: Range[] = []
  let frame = 0
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  const repaint = (): void => {
    frame = 0
    if (highlights === undefined || HighlightCtor === undefined) return
    const height = win!.innerHeight
    const width = win!.innerWidth
    const next: Range[] = []
    for (const c of citations) {
      if (!c.range.startContainer.isConnected) continue
      // A citation needs a target we can reach: a named file, or any open view.
      if (c.file === undefined && registry.size === 0) continue
      const r = c.range.getBoundingClientRect()
      if (r.bottom >= -height && r.top <= height * 2 && r.right >= 0 && r.left <= width && r.width > 0) {
        next.push(c.range)
        if (next.length >= 160) break
      }
    }
    if (next.length === painted.length && next.every((r, i) => r === painted[i])) return
    painted = next
    if (next.length === 0) highlights.delete(HIGHLIGHT)
    else highlights.set(HIGHLIGHT, new HighlightCtor(...next))
  }

  const rescan = (): void => {
    // Resolve the transcript root on every pass: it is mounted after this
    // plugin activates and can be replaced when switching sessions. Scanning
    // only that subtree keeps a PDF's own "[p.3]" out of the citation set.
    citations = scanCitations(chatRootOf(doc))
    if (frame === 0) frame = requestAnimationFrame(repaint)
  }

  const onClick = (event: MouseEvent): void => {
    const caretDoc = doc as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null; caretRangeFromPoint?(x: number, y: number): Range | null }
    const point = caretDoc.caretPositionFromPoint?.(event.clientX, event.clientY)
    const rangeAtPoint = point ? undefined : caretDoc.caretRangeFromPoint?.(event.clientX, event.clientY)
    const target = point?.offsetNode ?? rangeAtPoint?.startContainer
    if (!target || target.nodeType !== Node.TEXT_NODE || !chatRootOf(doc).contains(target)) return
    const text = target as Text
    const value = text.nodeValue ?? ''
    const offset = caretOffsetIn(text, event)
    if (offset < 0) return
    const hits = findPageCitations(value.slice(Math.max(0, offset - 500), offset + 500))
    for (const hit of hits) {
      const base = Math.max(0, offset - 500)
      if (offset >= base + hit.index && offset <= base + hit.index + hit.length) {
        void followCitation(hit, registry, opts)
        return
      }
    }
  }

  const rescanObserver = new MutationObserver(records => {
    if (records.every(record => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-textpreview-url],[data-paper-margin],[data-dsh-sidenote]'))) return
    if (settleTimer !== undefined) clearTimeout(settleTimer)
    settleTimer = setTimeout(rescan, 200)
  })
  // Observe the document body, not the chat root: the transcript subtree is
  // created after the plugin activates, so a root captured at install time can
  // be replaced and never observe anything again. Rescans are debounced.
  rescanObserver.observe(doc.body, { childList: true, subtree: true, characterData: true })
  doc.addEventListener('click', onClick)
  rescan()

  return () => {
    rescanObserver.disconnect()
    doc.removeEventListener('click', onClick)
    if (settleTimer !== undefined) clearTimeout(settleTimer)
    highlights?.delete(HIGHLIGHT)
  }
}

/** Character offset of the click within its text node; -1 when outside. */
function caretOffsetIn(node: Text, event: MouseEvent): number {
  const doc = node.ownerDocument
  if (doc.caretPositionFromPoint !== undefined) {
    const pos = doc.caretPositionFromPoint(event.clientX, event.clientY)
    if (pos !== null && pos.offsetNode === node) return pos.offset
    return -1
  }
  if (doc.caretRangeFromPoint !== undefined) {
    const range = doc.caretRangeFromPoint(event.clientX, event.clientY)
    if (range !== null && range.startContainer === node) return range.startOffset
    return -1
  }
  return -1
}

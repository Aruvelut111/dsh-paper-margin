import type { PdfViewImpl } from '../viewer/pdf-view'
import { readerSessionId } from './reader-surface'

interface ExternalNote { id: number; number: number; anchorText: string; note: string; state: string; externalSource?: { address?: string; page?: number } }
const EVENT = 'dsh-sidenote:external-annotation:v1'
/** Small reader adapter: sidenote remains the sole owner of saved annotations. */
export function attachPdfBadges(root: HTMLElement, view: PdfViewImpl, address: string, sessionId: string): () => void {
  let stopped = false; let frame = 0; let generation = 0
  const geometry = new Map<number, { text: string; page: number; found: Awaited<ReturnType<PdfViewImpl['locate']>> }>()
  const list = (): ExternalNote[] => {
    sessionId = readerSessionId(root) ?? sessionId
    let items: ExternalNote[] = []
    document.dispatchEvent(new CustomEvent(EVENT, { detail: { action: 'list', sessionId, reply: (result: { items?: ExternalNote[] }) => { items = result.items ?? [] } } }))
    return items.filter(item => item.state === 'active' && item.externalSource?.address === address && (item.externalSource.page ?? 0) > 0)
  }
  const draw = async () => {
    frame = 0; const run = ++generation
    const notes = list(); const ids = new Set(notes.map(item => String(item.id)))
    for (const badge of root.querySelectorAll<HTMLElement>('[data-paper-margin-badge], [data-paper-margin-saved-mark]')) if (!ids.has(badge.dataset.paperMarginBadge ?? badge.dataset.paperMarginSavedMark ?? '')) badge.remove()
    for (const item of notes) {
      const number = item.externalSource!.page!
      const page = root.querySelector<HTMLElement>('[data-paper-margin-page="' + number + '"]')
      if (!page || page.querySelector('[data-paper-margin-badge="' + item.id + '"]')) continue
      let cached = geometry.get(item.id)
      if (!cached || cached.text !== item.anchorText || cached.page !== number) {
        const found = await view.locate(item.anchorText, number, true)
        cached = { text: item.anchorText, page: number, found }; geometry.set(item.id, cached)
      }
      const found = cached.found
      if (stopped || generation !== run || !page.isConnected) return
      if (found?.page !== number) continue
      for (const box of found.boxes) {
        const mark = document.createElement('span'); mark.dataset.paperMarginSavedMark = String(item.id); mark.style.cssText = `position:absolute;pointer-events:none;z-index:1;background:rgba(47,136,255,.18);left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%`; page.append(mark)
      }
      const badge = document.createElement('button'); badge.type = 'button'; badge.dataset.paperMarginBadge = String(item.id); badge.textContent = String(item.number); badge.title = item.anchorText + (item.note ? '\n' + item.note : ''); badge.setAttribute('aria-label', '查看阅读批注 ' + item.number)
      const same = notes.filter(note => note.externalSource?.page === number); const offset = same.findIndex(note => note.id === item.id)
      badge.style.cssText = 'position:absolute;right:3px;z-index:4;width:23px;height:23px;border-radius:50%;border:1px solid #809bd2;cursor:pointer;color:#fff;background:#2f88ff'
      badge.style.top = Math.max(4, Math.min(page.offsetHeight - 28, ((found.boxes[0]?.y ?? 0.04) * page.offsetHeight) + offset * 25)) + 'px'
      badge.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation(); const rect = badge.getBoundingClientRect(); view.reveal(number, found.boxes)
        document.dispatchEvent(new CustomEvent(EVENT, { detail: { action: 'edit', id: item.id, sessionId, point: { x: rect.left - 300, y: rect.bottom }, reply: () => undefined } }))
      })
      page.append(badge)
    }
  }
  const schedule = () => { if (!stopped && !frame) frame = requestAnimationFrame(() => { void draw().catch(() => undefined) }) }
  const changed = () => { generation++; const ids = new Set(list().map(item => item.id)); for (const id of geometry.keys()) if (!ids.has(id)) geometry.delete(id); for (const badge of root.querySelectorAll('[data-paper-margin-badge], [data-paper-margin-saved-mark]')) badge.remove(); schedule() }
  const observer = new MutationObserver(records => { if (records.some(record => [...record.addedNodes].some(node => node instanceof HTMLElement && (node.hasAttribute('data-paper-margin-page') || node.classList.contains('textLayer'))))) schedule() })
  observer.observe(root, { childList: true, subtree: true }); document.addEventListener('dsh-sidenote:external-annotations-changed', changed); schedule()
  return () => { stopped = true; generation++; geometry.clear(); if (frame) cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('dsh-sidenote:external-annotations-changed', changed); for (const badge of root.querySelectorAll('[data-paper-margin-badge], [data-paper-margin-saved-mark]')) badge.remove() }
}

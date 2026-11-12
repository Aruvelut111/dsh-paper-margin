import type { PdfViewRegistry } from '../viewer/registry'
import { findDocumentQuote, revealDocumentQuote } from './document-notes'
import type { TextAnchor } from './text-anchor'

/** Source navigation is owned by the reader, while sidenote owns the annotation. */
export function attachExternalReveal(registry: PdfViewRegistry, open: (address: string) => void, notify: (message: string) => void): () => void {
  const reveal = async (event: Event) => {
    const detail = (event as CustomEvent<{ sessionId?: string; text?: string; source?: { label?: string; address?: string; page?: number; anchor?: TextAnchor } }>).detail
    const address = detail?.source?.address
    if (typeof address !== 'string' || !address.startsWith('dsh-resource://file/')) { notify('此来源请在原网页中查看'); return }
    open(address)
    if (!/\.pdf(?:$|[?#])/i.test(address)) {
      // Previews mount asynchronously. Scope the wait to the requested owner.
      const root = await new Promise<HTMLElement | undefined>(resolve => {
        const find = () => [...document.querySelectorAll<HTMLElement>('[data-textpreview-url]')].find(element => element.getAttribute('data-textpreview-url') === address && (!detail.sessionId || element.closest('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session') === detail.sessionId) && (element.querySelector('iframe[data-paper-margin-html],[data-image-preview],[data-excel-preview]') || detail.text && findDocumentQuote(element, detail.text, detail.source?.anchor)))
        const ready = find(); if (ready) { resolve(ready); return }
        const observer = new MutationObserver(() => { const root = find(); if (root) { clearTimeout(timer); observer.disconnect(); resolve(root) } })
        const timer = setTimeout(() => { observer.disconnect(); resolve(undefined) }, 5000)
        observer.observe(document.body, { subtree: true, childList: true })
      })
      if (root && detail.text) {
        document.dispatchEvent(new CustomEvent('dsh-paper-margin:reveal-document', { detail: { address, sessionId: detail.sessionId, text: detail.text, anchor: detail.source?.anchor } }))
        revealDocumentQuote(root, detail.text, detail.source?.anchor)
      }
      return
    }
    const entry = registry.find(address) ?? await registry.waitFor(address)
    if (!entry) { notify('原文件未打开，请检查文件位置'); return }
    const found = detail.text ? await entry.view.locate(detail.text, detail.source?.page) : null
    entry.view.reveal(found?.page ?? detail.source?.page ?? 1, found?.boxes ?? [])
  }
  const listener = (event: Event) => { void reveal(event).catch(() => notify('无法定位来源，请重新打开文件')) }
  document.addEventListener('dsh-sidenote:reveal-external:v1', listener)
  return () => document.removeEventListener('dsh-sidenote:reveal-external:v1', listener)
}

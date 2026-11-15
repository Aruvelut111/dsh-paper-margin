import type { NativePage, PageCommand, PageOutcome } from '../../browser-contract'
import { pageFailure } from '../../browser-contract'
import { readerSessionId, readerSurfaceVisible } from '../annotate/reader-surface'
import { readNativeDocument } from './read-page'

interface NativeFrame extends HTMLElement {
  getURL(): string
  getTitle?(): string
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}
export const PAGE_SELECTOR = 'webview[data-sidebar-browser-frame]'
const pageEpochs = new WeakMap<Element, number>()
export function nativePageNavigated(element: Element): void {
  pageEpochs.set(element, (pageEpochs.get(element) ?? 0) + 1)
}
/** The same stable renderer-local identity travels with captures and tool requests. */
export function nativePageId(element: Element): string | undefined {
  if (!element.matches(PAGE_SELECTOR)) return undefined
  const frame = element as HTMLElement
  return frame.dataset.paperMarginPageId ??= 'pm-' + crypto.randomUUID()
}
export function nativePages(): NativePage[] {
  const pages: NativePage[] = []
  for (const element of document.querySelectorAll(PAGE_SELECTOR)) {
    const frame = element as NativeFrame
    const sessionId = readerSessionId(frame)
    if (!sessionId || typeof frame.executeJavaScript !== 'function') continue
    try {
      const url = frame.getURL()
      if (!/^https?:\/\//i.test(url)) continue
      pages.push({ id: nativePageId(frame)!, sessionId, url, title: (frame.getTitle?.() ?? '').slice(0, 500), visible: readerSurfaceVisible(frame) })
    } catch { /* A guest can be between attachment and dom-ready. */ }
    if (pages.length === 64) break
  }
  return pages
}
export async function executePageRead(command: PageCommand): Promise<PageOutcome> {
  const frame = [...document.querySelectorAll(PAGE_SELECTOR)].find(element => nativePageId(element) === command.request.pageId) as NativeFrame | undefined
  const epoch = frame && pageEpochs.get(frame)
  const matches = () => {
    try { return !!frame?.isConnected && pageEpochs.get(frame) === epoch && readerSessionId(frame) === command.sessionId && frame.getURL() === command.request.expectedUrl } catch { return false }
  }
  if (!matches()) return pageFailure('PAGE_CHANGED', 'The source page is closed, has navigated, or belongs to a different conversation.')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const outcome = await Promise.race([
      frame!.executeJavaScript('(' + readNativeDocument.toString() + ')(window,' + JSON.stringify(command.request) + ')', false) as Promise<PageOutcome>,
      new Promise<PageOutcome>(resolve => { timer = setTimeout(() => resolve(pageFailure('PAGE_TIMEOUT', 'The page did not respond to the read request.')), 7000) }),
    ])
    return matches() ? outcome : pageFailure('PAGE_CHANGED', 'The source page changed while it was being read; its result was discarded.')
  } catch {
    return pageFailure('PAGE_UNAVAILABLE', 'The native page could not be read. It may be loading or closing.')
  } finally { clearTimeout(timer) }
}


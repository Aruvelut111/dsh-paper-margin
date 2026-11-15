// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { readNativeDocument } from '../src/client/browser/read-page'
import { executePageRead, nativePageId, nativePageNavigated, nativePages } from '../src/client/browser/pages'
import { attachNativePageReader } from '../src/client/browser/bridge'
import { validRead, type PageRead } from '../src/browser-contract'
import { buildProtocolBlock, splitProtocolPrefix } from '../src/integrations/sidenote/client/annotations/format'
import { createAnnotationStore } from '../src/integrations/sidenote/client/annotations/model'
import { registerExternalAnnotations } from '../src/integrations/sidenote/client/annotations/external'
import { captureInSidenote } from '../src/client/annotate/sidenote'

const url = location.href
const request = (extra: Partial<PageRead> = {}): PageRead => ({ action: 'read', pageId: 'pm-page', expectedUrl: url, ...extra })
function rendered(text: string) {
  Object.defineProperty(document.body, 'innerText', { configurable: true, get: () => text })
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it('bounds reads, carries scope, and requires an unchanged document for pagination', () => {
  rendered('first line\n' + 'a'.repeat(25_000))
  const first = readNativeDocument(window, request({ limit: 100 }))
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(first.value).toMatchObject({ scope: 'rendered-main-document', offset: 0, nextOffset: 100, textLimitReached: false })
  expect(first.value.text).toHaveLength(100)
  expect(readNativeDocument(window, request({ offset: 100 }))).toMatchObject({ ok: false, code: 'VERSION_REQUIRED' })
  expect(readNativeDocument(window, request({ offset: 100, version: first.value.version }))).toMatchObject({ ok: true, value: { offset: 100 } })
  rendered('changed')
  expect(readNativeDocument(window, request({ offset: 100, version: first.value.version }))).toMatchObject({ ok: false, code: 'CONTENT_CHANGED' })
})
it('finds exact quotes with nearby context and reports limits and excluded frames', () => {
  rendered('before needle after '.repeat(8) + 'x'.repeat(1_000_000))
  document.body.innerHTML = '<iframe></iframe>'
  const result = readNativeDocument(window, request({ action: 'find', query: 'needle' }))
  expect(result).toMatchObject({ ok: true, value: { textLimitReached: true, readableCharacters: 1_000_000, embeddedFrames: 1 } })
  if (!result.ok) return
  expect(result.value.matches).toHaveLength(5)
  expect(result.value.matches?.[0]?.text).toContain('before needle after')
  expect(result.value.nextOffset).toBeGreaterThan(0)
  expect(readNativeDocument(window, request({ action: 'find', query: 'Needle' }))).toMatchObject({ ok: true, value: { matches: [] } })
  expect(readNativeDocument(window, request({ expectedUrl: 'https://other.test/' }))).toMatchObject({ ok: false, code: 'PAGE_CHANGED' })
})
it('extracts rendered text once per explicit request and validates bounded arguments', () => {
  const getter = vi.fn(() => 'hello')
  Object.defineProperty(document.body, 'innerText', { configurable: true, get: getter })
  readNativeDocument(window, request())
  expect(getter).toHaveBeenCalledTimes(1)
  for (const bad of [{ limit: 20001 }, { offset: -1 }, { offset: 1.5 }, { action: 'find', query: '' }]) expect(validRead(request(bad as never))).toBe(false)
})
it('reads ordinary HTTP pages where crypto.randomUUID is unavailable', () => {
  rendered('HTTP source text')
  delete (window as Window & { __paperMarginReadDocument?: string }).__paperMarginReadDocument
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('Secure context required') })
  expect(readNativeDocument(window, request())).toMatchObject({ ok: true, value: { text: 'HTTP source text' } })
})
function frame(owner: string, pageUrl = 'https://page.test/') {
  const root = document.createElement('aside')
  root.dataset.sidebarRightSession = owner; root.dataset.sidebarRightPanel = ''; root.dataset.sidebarRightOpen = ''
  const element = document.createElement('webview') as HTMLElement & { getURL(): string; getTitle(): string; executeJavaScript: ReturnType<typeof vi.fn> }
  element.setAttribute('data-sidebar-browser-frame', '')
  element.getURL = () => pageUrl; element.getTitle = () => 'Native page'
  element.executeJavaScript = vi.fn(async () => ({ ok: true, value: { pageId: nativePageId(element), url: pageUrl } }))
  root.append(element); document.body.append(root)
  return element
}
it('binds duplicate URLs to distinct pages and rejects wrong sessions, navigation and closure', async () => {
  const a = frame('main'); const b = frame('side')
  const pages = nativePages()
  expect(pages).toHaveLength(2)
  expect(nativePageId(a)).not.toBe(nativePageId(b))
  const command = { id: 'r', sessionId: 'main', request: request({ pageId: nativePageId(a), expectedUrl: 'https://page.test/' }) }
  expect(await executePageRead({ ...command, sessionId: 'side' })).toMatchObject({ ok: false, code: 'PAGE_CHANGED' })
  expect(a.executeJavaScript).not.toHaveBeenCalled()
  let finish!: (value: unknown) => void
  a.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const reading = executePageRead(command)
  nativePageNavigated(a)
  finish({ ok: true, value: {} })
  expect(await reading).toMatchObject({ ok: false, code: 'PAGE_CHANGED' })
  a.remove()
  expect(await executePageRead(command)).toMatchObject({ ok: false })
})
it('does no guest text work or extra polls on scrolling while idle and cancels on unload', async () => {
  const a = frame('main')
  let aborted = false
  const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  }))
  const stop = attachNativePageReader(fetcher as typeof fetch)
  expect(fetcher).toHaveBeenCalledTimes(1)
  for (let index = 0; index < 30; index++) a.dispatchEvent(new Event('scroll'))
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(a.executeJavaScript).not.toHaveBeenCalled()
  stop()
  expect(aborted).toBe(true)
})
it('keeps native page identity through capture, persistence and batch formatting', () => {
  const store = createAnnotationStore(() => 1, null)
  const off = registerExternalAnnotations(store, () => undefined)
  expect(captureInSidenote({ sessionId: 'main', text: 'Selected text', note: 'Explain this', edit: false,
    source: { label: 'Page', address: 'https://page.test/', browserPageId: 'pm-page' } })).toBe(true)
  const note = store.list('main')[0]!
  expect(note.externalSource?.browserPageId).toBe('pm-page')
  const quote = splitProtocolPrefix(buildProtocolBlock([{ ...note, text: note.text }]))?.annotations[0]?.quote
  expect(quote).toContain('[Sidebar page: "pm-page"]')
  expect(quote).toContain('[Source session: "main"]')
  off()
})


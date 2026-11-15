// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { sidebarResources } from '../src/client/browser/sidebar'
import { nativePages } from '../src/client/browser/pages'
import { attachNativePageReader } from '../src/client/browser/bridge'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
const file = 'dsh-resource://file/session/main/docs/a%20b.pdf'
function fixture() {
  document.body.innerHTML = '<aside data-sidebar-right-session="main" data-sidebar-right-panel data-sidebar-right-open>'
    + '<span data-sidebar-right-tab="pdf">PDF title only</span><div data-sidebar-right-tab="pdf"></div>'
    + '<div data-sidebar-right-tab="web" hidden><webview data-sidebar-browser-frame></webview></div>'
    + '<div data-sidebar-right-tab="side" hidden></div></aside>'
  const frame = document.querySelector('webview') as HTMLElement & { getURL(): string; getTitle(): string; executeJavaScript: ReturnType<typeof vi.fn> }
  frame.getURL = () => 'https://page.test/'
  frame.getTitle = () => 'Whole page'
  frame.executeJavaScript = vi.fn()
  const live = [
    { id: 'pdf', kind: 'document', title: 'a b.pdf', contentId: file },
    { id: 'web', kind: 'browser', title: 'Browser' },
    { id: 'side', kind: 'dsh-sidenote:side', title: 'Side chat' },
  ]
  let active = 'pdf'
  const listeners = new Set<() => void>()
  const sidebar = {
    mounted: { getSnapshot: () => 'main', subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } },
    openTabs: { getSnapshot: () => [...live.map(tab => ({ ...tab, sessionId: 'main', tabId: tab.id })), { sessionId: 'old', tabId: 'archived', kind: 'document', contentId: file }], subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } },
    tabsIn: (sessionId: string) => sessionId === 'main' ? live : [],
    active: () => ({ id: active }),
  }
  return { source: { get: () => sidebar }, live, frame, listeners, activate: (id: string) => { active = id; for (const fn of listeners) fn() } }
}

it('uses live native layouts and decodes source paths without reading page content', () => {
  const { source, frame, live } = fixture()
  const resources = sidebarResources(source, nativePages())
  expect(resources).toHaveLength(3)
  expect(resources[0]).toMatchObject({ kind: 'file', path: 'docs/a b.pdf', sourceSessionId: 'main', active: true, visible: true })
  expect(resources[1]).toMatchObject({ kind: 'webpage', title: 'Whole page', visible: false, active: false, pageId: expect.stringMatching(/^pm-/) })
  expect(resources[2]).toMatchObject({ kind: 'conversation' })
  expect(resources.some(item => item.sessionId === 'old')).toBe(false)
  expect(frame.executeJavaScript).not.toHaveBeenCalled()
  live.shift()
  // A retained title/body cannot resurrect a tab removed from native membership.
  expect(sidebarResources(source, nativePages()).some(item => item.kind === 'file')).toBe(false)
})

it('does not count a visible title as a visible file body', () => {
  const { source } = fixture()
  document.querySelector('div[data-sidebar-right-tab="pdf"]')!.setAttribute('hidden', '')
  expect(sidebarResources(source, nativePages())[0]).toMatchObject({ active: false, visible: false })
})

it('publishes changes promptly, ignores unchanged input focus and disposes subscriptions', async () => {
  const { source, frame, activate, listeners } = fixture()
  const bodies: unknown[] = []
  const fetcher = vi.fn((_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  })
  const stop = attachNativePageReader(fetcher as typeof fetch, source)
  try {
    expect(fetcher).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 20; i++) document.dispatchEvent(new Event('focusin'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetcher).toHaveBeenCalledTimes(1)
    activate('web')
    document.querySelector('div[data-sidebar-right-tab="pdf"]')!.setAttribute('hidden', '')
    document.querySelector('div[data-sidebar-right-tab="web"]')!.removeAttribute('hidden')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(bodies.at(-1)).toMatchObject({ resources: expect.arrayContaining([expect.objectContaining({ id: 'web', active: true, visible: true })]) })
    expect(frame.executeJavaScript).not.toHaveBeenCalled()
  } finally { stop() }
  expect(listeners.size).toBe(0)
})

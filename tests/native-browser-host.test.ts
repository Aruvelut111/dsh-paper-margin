import { afterEach, expect, it, vi } from 'vitest'
import { NativePageBridge } from '../src/host/browser-bridge'
import { applyNativeBrowser } from '../src/host/browser'
import type { NativePage, PageOutcome, PageRead } from '../src/browser-contract'

const bridges: NativePageBridge[] = []
afterEach(() => { for (const bridge of bridges) bridge.dispose(); bridges.length = 0; vi.useRealTimers() })
const page = (sessionId = 'main', id = 'pm-first'): NativePage => ({ sessionId, id, url: 'https://page.test/', title: 'Page', visible: true })
const request: PageRead = { action: 'read', pageId: 'pm-first', expectedUrl: 'https://page.test/' }
const success: PageOutcome = { ok: true, value: { pageId: 'pm-first', url: 'https://page.test/', title: 'Page', version: 'v1', readAt: 'now', scope: 'rendered-main-document', totalCharacters: 5, readableCharacters: 5, textLimitReached: false, embeddedFrames: 0, offset: 0, nextOffset: null, text: 'hello' } }
function make() { const bridge = new NativePageBridge(); bridges.push(bridge); return bridge }
it('only lists and reads pages belonging to the initiating conversation', async () => {
  const bridge = make()
  const polling = bridge.poll('window', [page(), page('side', 'pm-side')], new AbortController().signal)
  expect(bridge.list('main').map(p => p.id)).toEqual(['pm-first'])
  expect(await bridge.read('other', request)).toMatchObject({ ok: false, code: 'PAGE_NOT_FOUND' })
  const result = bridge.read('main', request)
  const commands = await polling
  expect(commands[0]?.sessionId).toBe('main')
  expect(bridge.result('wrong-window', commands[0]!.id, success)).toBe(false)
  expect(bridge.result('window', commands[0]!.id, success)).toBe(true)
  expect(await result).toEqual(success)
})
it('does not fall back across windows or identical URLs', async () => {
  const bridge = make()
  const first = bridge.poll('a', [page()], new AbortController().signal)
  const second = bridge.poll('b', [page('main', 'pm-other')], new AbortController().signal)
  const result = bridge.read('main', { ...request, pageId: 'pm-other' })
  const commands = await second
  expect(commands[0]?.request.pageId).toBe('pm-other')
  bridge.result('b', commands[0]!.id, { ok: false, code: 'TEST', message: 'done' })
  await result
  bridge.dispose()
  expect(await first).toEqual([])
})
it('discards pending reads on navigation, closure or conversation reassignment', async () => {
  for (const pages of [[], [{ ...page(), url: 'https://page.test/new' }], [page('side')]]) {
    const bridge = make()
    const poll = bridge.poll('window', [page()], new AbortController().signal)
    const reading = bridge.read('main', request)
    const command = (await poll)[0]!
    const next = bridge.poll('window', pages, new AbortController().signal)
    expect(await reading).toMatchObject({ ok: false, code: 'PAGE_CHANGED' })
    expect(bridge.result('window', command.id, success)).toBe(false)
    bridge.dispose(); await next
  }
})
it('removes queued commands and timers when cancelled or disposed', async () => {
  vi.useFakeTimers()
  const bridge = make()
  const controller = new AbortController()
  const poll = bridge.poll('window', [page()], controller.signal)
  controller.abort(); await poll
  const abort = new AbortController()
  const cancelled = bridge.read('main', request, abort.signal)
  abort.abort()
  expect(await cancelled).toMatchObject({ ok: false, code: 'CANCELLED' })
  const pending = bridge.read('main', request)
  bridge.dispose()
  expect(await pending).toMatchObject({ ok: false, code: 'CANCELLED' })
  expect(vi.getTimerCount()).toBe(0)
})
it('rejects mismatched page responses and expires reads', async () => {
  vi.useFakeTimers()
  const bridge = make()
  const poll = bridge.poll('window', [page()], new AbortController().signal)
  const reading = bridge.read('main', request)
  bridge.result('window', (await poll)[0]!.id, { ...success, value: { ...success.value, url: 'https://wrong.test/' } })
  expect(await reading).toMatchObject({ ok: false, code: 'PAGE_CHANGED' })
  const timed = bridge.read('main', request)
  await vi.advanceTimersByTimeAsync(12_000)
  expect(await timed).toMatchObject({ ok: false, code: 'PAGE_TIMEOUT' })
})
it('uses official authenticated Fetch routes and obtains session identity from tool execution', async () => {
  const routes: Array<{ path: string; methods: string[]; fetch(req: Request): Promise<Response> }> = []
  let tool: { output: { schema: unknown }; execute(args: Record<string, unknown>, exec: unknown): Promise<unknown> } | undefined
  let dispose!: () => void
  applyNativeBrowser({ inject(deps: string[], install: (ctx: unknown) => () => void) {
    expect(deps).toEqual(['connection', 'tools'])
    dispose = install({ get(name: string) {
      if (name === 'connection') return { fetch: { register(route: typeof routes[number]) { routes.push(route); return () => {} } } }
      return { register(value: typeof tool) { tool = value; return () => {} } }
    } })
  } })
  expect(routes.map(route => route.path)).toEqual(['/api/paper-margin/browser/poll', '/api/paper-margin/browser/result'])
  // DSH output uses JSON Schema, not the input value-spec's type: 'json'.
  expect(tool!.output.schema).toEqual({ type: 'object', additionalProperties: true })
  await expect(tool!.execute({ action: 'list', sessionId: 'main' }, {})).rejects.toThrow('initiating conversation')
  expect(await tool!.execute({ action: 'list' }, { agent: { session: { id: 'main' } } })).toEqual({ pages: [] })
  const malformed = new Request('http://localhost' + routes[0]!.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"pages":[]}' })
  expect((await routes[0]!.fetch(malformed)).status).toBe(400)
  dispose()
})


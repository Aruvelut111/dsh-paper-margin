import { afterEach, expect, it, vi } from 'vitest'
import { NativePageBridge } from '../src/host/browser-bridge'
import { registerSidebarContext } from '../src/host/sidebar-context'
import type { SidebarResource } from '../src/browser-contract'

const file = (sessionId: string, id = 'file'): SidebarResource => ({ id, sessionId, kind: 'file', title: 'A {{literal}} file',
  address: 'dsh-resource://file/session/' + sessionId + '/docs/main.pdf', path: 'docs/main.pdf', sourceSessionId: sessionId,
  active: true, visible: true, loaded: true })
afterEach(() => vi.useRealTimers())

it('refreshes ambient metadata per initiating Agent, then clears closed sources', async () => {
  const bridge = new NativePageBridge()
  let entry!: Parameters<Parameters<typeof registerSidebarContext>[0]['context']>[0]
  const off = vi.fn()
  expect(registerSidebarContext({ context(value) { entry = value; return off } }, bridge)).toBe(off)
  expect(entry.interpolate).toBe(false)
  expect(entry.text({})).toBe('')
  const poll = bridge.poll('window', [], new AbortController().signal, [file('main'), file('side', 'side-file')])
  const main = entry.text({ agent: { session: { id: 'main' } } })
  expect(main).toContain('A {{literal}} file')
  expect(main).toContain('docs/main.pdf')
  expect(main).not.toContain('side-file')
  expect(entry.text({ agent: { session: { id: 'side' } } })).toContain('side-file')
  const next = bridge.poll('window', [], new AbortController().signal, [])
  expect(entry.text({ agent: { session: { id: 'main' } } })).toBe('')
  bridge.dispose(); await Promise.all([poll, next])
})

it('keeps same-numbered tabs in separate windows and drops disconnected inventories', async () => {
  vi.useFakeTimers()
  const bridge = new NativePageBridge()
  const a = bridge.poll('a', [], new AbortController().signal, [file('main')])
  const b = bridge.poll('b', [], new AbortController().signal, [file('main')])
  expect(bridge.resources('main').map(item => item.windowId)).toEqual(['a', 'b'])
  await vi.advanceTimersByTimeAsync(45_001)
  expect(bridge.resources('main')).toEqual([])
  bridge.dispose(); await Promise.all([a, b])
})

it('bounds runtime context and puts the active visible source first', () => {
  let entry!: Parameters<Parameters<typeof registerSidebarContext>[0]['context']>[0]
  registerSidebarContext({ context(value) { entry = value; return () => {} } }, { resources: () => Array.from({ length: 64 }, (_, i) => ({
    ...file('main', String(i)), windowId: 'window', title: 'x'.repeat(500), active: i === 63, visible: i === 63,
  })) })
  const text = entry.text({ agent: { session: { id: 'main' } } })
  const data = JSON.parse(text.slice(text.indexOf('\n{') + 1))
  expect(data.resources[0].id).toBe('63')
  expect(data.resources).toHaveLength(16)
  expect(data.inventoryTruncated).toBe(true)
  expect(text.length).toBeLessThan(13_000)
})

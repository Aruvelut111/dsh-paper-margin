import { expect, it } from 'vitest'
import { sourceLocator } from '../src/client/viewer/address'
import { applyCitationGuide, CITATION_GUIDE } from '../src/host/citation-guide'
import { buildProtocolBlock, splitProtocolPrefix } from '../src/integrations/sidenote/client/annotations/format'
import { buildProtocolBlock as fallbackBlock } from '../src/contract'

it('exposes decoded file paths while keeping relative source-session ownership', () => {
  expect(sourceLocator('dsh-resource://file/absolute/E%3A/%E8%B5%84%E6%96%99/a%20b.pdf', 's')).toContain('[File path: "E:/资料/a b.pdf"]')
  expect(sourceLocator('dsh-resource://file/session/parent/docs/main.md', 'child')).toContain('[File path: "docs/main.md"]\n[Source session: "parent"]')
  expect(sourceLocator('https://example.test/login?a=1#part')).toBe('[Source: https://example.test/login?a=1#part]')
  expect(sourceLocator('dsh-resource://file/session/s/%ZZ')).not.toContain('[File path:')
})

it('preserves each source, number, comment and user question in a mixed-source batch', () => {
  const first = { sessionId: 's', number: 1, text: '[spec.pdf · p.7]\nLimit is a < b', note: 'Compare with 2', externalSource: { label: 'spec.pdf · p.7', address: 'dsh-resource://file/session/s/E%3A/docs/spec.pdf', page: 7 } }
  const second = { sessionId: 's', number: 2, text: '[website]\nLimit depends on configuration', note: 'Does this contradict 1?', externalSource: { label: 'website', address: 'https://example.test/spec?a=1&b=2' } }
  const question = 'Explain the difference using these two sources.'
  const wire = buildProtocolBlock([first, second]) + '\n\n' + question
  const parsed = splitProtocolPrefix(wire)!
  expect(parsed.annotations.map(item => item.id)).toEqual([1, 2])
  expect(parsed.annotations[0]).toMatchObject({ note: first.note, quote: expect.stringContaining('[File path: "E:/docs/spec.pdf"]') })
  expect(parsed.annotations[0]?.quote).toContain('Limit is a < b')
  expect(parsed.annotations[1]).toMatchObject({ note: second.note, quote: expect.stringContaining('[Source: https://example.test/spec?a=1&b=2]') })
  expect(wire.slice(parsed.length)).toBe(question)
})

it('uses the same file locator in the fallback protocol', () => {
  const wire = fallbackBlock([{ id: 'a', file: 'notes.md', sessionId: 's', sourceAddress: 'dsh-resource://file/session/s/docs/notes.md', anchor: { page: 0, quote: 'selected', order: 0, rects: [] }, note: '', state: 'active', createdAt: 1 }])
  expect(splitProtocolPrefix(wire)?.annotations[0]?.quote).toContain('[File path: "docs/notes.md"]\n[Source session: "s"]')
})

it('installs source-reading guidance through the existing agent lifecycle', () => {
  let created: ((payload: never) => void) | undefined
  let section: { name: string; text: string } | undefined
  let disposed = false
  applyCitationGuide({ on(event, handler) { expect(event).toBe('agent/created'); created = handler as typeof created } })
  created!({ agent: { ctx: { get(name: string) { expect(name).toBe('systemPrompt'); return { section(value: typeof section) { section = value; return () => { disposed = true } } } }, effect(install: () => () => void) { const off = install(); expect(disposed).toBe(false); off() } } } } as never)
  expect(section?.name).toBe('dsh-paper-margin')
  expect(section?.text).toBe(CITATION_GUIDE)
  expect(section?.text).toContain('The full source and page images are not automatically included')
  expect(section?.text).toContain('annotation ids and sources')
  expect(disposed).toBe(true)
})

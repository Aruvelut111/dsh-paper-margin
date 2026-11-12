// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createAnnotationStore } from './fixtures/sidenote/src/client/annotations/model'
import { registerExternalAnnotations } from './fixtures/sidenote/src/client/annotations/external'
import { buildProtocolBlock as sidenoteBlock, splitProtocolPrefix } from './fixtures/sidenote/src/client/annotations/format'
import { captureInSidenote, sidenoteAvailable } from '../src/client/annotate/sidenote'
import { buildProtocolBlock } from '../src/contract'
import { createAnnotation } from '../src/client/annotate/model'

afterEach(() => { localStorage.clear() })
it('uses the real sidenote store, editor callback, numbering, persistence and parser', () => {
  const store = createAnnotationStore(() => 1, localStorage); const open = vi.fn()
  expect(sidenoteAvailable()).toBe(false)
  const off = registerExternalAnnotations(store, open)
  expect(sidenoteAvailable()).toBe(true)
  const text = '原文 </quote> & <tag> 多行'
  expect(captureInSidenote({ sessionId: 's', text, source: { label: 'book.pdf · p.7', address: 'dsh-resource://file/session/s/book.pdf', page: 7 }, point: { x: 10, y: 80 } })).toBe(true)
  const first = store.listActive('s')[0]!
  expect(first.text).toBe('[book.pdf · p.7]'+String.fromCharCode(10)+text)
  expect(open).toHaveBeenCalledOnce(); expect(open.mock.calls[0]?.[1]).toEqual({ x: 10, y: 80 })
  store.setNote(first.id, '任意文字 </note> & <tag>')
  captureInSidenote({ sessionId: 's', text: '另一个选区', note: '第二条', source: { label: 'notes.md' }, edit: false })
  expect(store.listActive('s').map(a => a.number)).toEqual([1, 2])
  expect(open).toHaveBeenCalledOnce()
  const wire = sidenoteBlock(store.listActive('s')); const parsed = splitProtocolPrefix(wire)!
  expect(parsed.annotations).toHaveLength(2); expect(parsed.annotations[0]?.quote).toBe(first.text + '\n[Source: dsh-resource://file/session/s/book.pdf]'); expect(parsed.annotations[0]?.note).toBe('任意文字 </note> & <tag>')
  expect(createAnnotationStore(() => 2, localStorage).listActive('s')[0]?.externalSource?.page).toBe(7)
  expect(store.listActive('another')).toHaveLength(0)
  off(); expect(sidenoteAvailable()).toBe(false)
})
it('fallback batches are understood by the real sidenote parser', () => {
  const a = createAnnotation({ id: 'a', file: 'book.pdf', page: 2, quote: 'a </quote> & b', note: 'c </note>', rects: [], createdAt: 1 })
  const parsed = splitProtocolPrefix(buildProtocolBlock([a]))!
  expect(parsed.annotations[0]).toMatchObject({ quote: '[book.pdf · p.2]'+String.fromCharCode(10)+'a </quote> & b', note: 'c </note>' })
})

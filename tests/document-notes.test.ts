// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createAnnotationStore } from './fixtures/sidenote/src/client/annotations/model'
import { registerExternalAnnotations } from './fixtures/sidenote/src/client/annotations/external'
import { attachDocumentNotes, findDocumentQuote } from '../src/client/annotate/document-notes'

afterEach(() => { document.body.replaceChildren(); localStorage.clear() })
it('restores document actions after tab replacement and reload, without mixing sessions', async () => {
  const address = 'dsh-resource://file/session/a/book.md'
  let store = createAnnotationStore(() => 1, localStorage); const open = vi.fn()
  const note = store.add({ sessionId: 'a', text: 'quote', anchorText: 'quote', anchorKey: undefined, occurrence: 0, note: 'saved', externalSource: { label: 'book.md', address } })
  store.add({ sessionId: 'b', text: 'private', anchorText: 'private', anchorKey: undefined, occurrence: 0, note: 'other session', externalSource: { label: 'book.md', address } })
  let off = registerExternalAnnotations(store, open)
  document.body.innerHTML = `<section data-sidebar-right-session="a"><article data-textpreview-url="${address}"><p>quote</p></article></section>`
  let stop = attachDocumentNotes()
  expect(document.querySelector('[data-paper-margin-document-notes]')?.textContent).toContain('本文批注 1')
  const original = document.querySelector('[data-textpreview-url]')!; original.innerHTML = '<p><strong>quote</strong></p>'; await Promise.resolve(); await Promise.resolve()
  expect(document.querySelector('[data-paper-margin-document-badge]')?.textContent).toBe('1')
  document.querySelector('[data-textpreview-url]')!.remove(); await Promise.resolve(); await Promise.resolve()
  expect(document.querySelector('[data-paper-margin-document-notes]')).toBeNull()
  document.querySelector('section')!.innerHTML = `<article data-textpreview-url="${address}"><p>quote</p></article>`
  await Promise.resolve(); await Promise.resolve()
  expect(document.querySelector('[data-paper-margin-document-notes]')?.textContent).toContain('本文批注 1')
  stop(); off(); store = createAnnotationStore(() => 2, localStorage); off = registerExternalAnnotations(store, open); stop = attachDocumentNotes()
  store.markSent([note.id]); await Promise.resolve()
  expect(document.querySelector('[data-paper-margin-document-badge]')).toBeNull()
  expect(document.querySelector('[data-paper-margin-document-notes]')).toBeNull()
  document.querySelector('[data-textpreview-url]')!.innerHTML = '<div data-paper-margin>PDF reader</div>'; await Promise.resolve(); await Promise.resolve()
  expect(document.querySelector('[data-paper-margin-document-overlay]')).toBeNull()
  stop(); off(); expect(document.querySelector('[data-paper-margin-document-notes]')).toBeNull()
})
it('finds unique text across nodes and refuses ambiguous or stale anchors', () => {
  const root = document.createElement('article'); root.innerHTML = '<p>Hello <strong>world</strong>!</p><button>Hello world!</button>'
  expect(findDocumentQuote(root, 'Hello world!')?.toString()).toBe('Hello world!')
  root.append(document.createTextNode(' Hello world!'))
  expect(findDocumentQuote(root, 'Hello world!')).toBeUndefined()
  expect(findDocumentQuote(root, 'edited source')).toBeUndefined()
})
it('hides body-level marks for a collapsed or hidden retained sidebar and restores on reopen', async () => {
  const address = 'book.md'; const store = createAnnotationStore(() => 1, null)
  store.add({ sessionId: 'a', text: 'quote', anchorText: 'quote', anchorKey: undefined, occurrence: 0, note: '', externalSource: { label: 'book', address } })
  document.body.innerHTML = '<section data-sidebar-right-session="a" data-sidebar-right-panel="push" data-sidebar-right-open><article data-textpreview-url="book.md"><p>quote</p></article></section>'
  const off = registerExternalAnnotations(store, vi.fn()); const stop = attachDocumentNotes(); const panel = document.querySelector('section')!
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
  await frame(); expect((document.querySelector('[data-paper-margin-document-overlay]') as HTMLElement).style.display).toBe('')
  panel.removeAttribute('data-sidebar-right-open'); await frame(); await frame(); expect((document.querySelector('[data-paper-margin-document-overlay]') as HTMLElement).style.display).toBe('none')
  panel.setAttribute('data-sidebar-right-open', ''); await frame(); await frame(); expect((document.querySelector('[data-paper-margin-document-overlay]') as HTMLElement).style.display).toBe('')
  panel.setAttribute('hidden',''); await frame(); await frame(); expect((document.querySelector('[data-paper-margin-document-overlay]') as HTMLElement).style.display).toBe('none')
  panel.removeAttribute('hidden'); panel.setAttribute('style', 'visibility:hidden'); await frame(); await frame(); expect((document.querySelector('[data-paper-margin-document-overlay]') as HTMLElement).style.display).toBe('none')
  panel.setAttribute('style', ''); await frame(); await frame(); expect((document.querySelector('[data-paper-margin-document-overlay]') as HTMLElement).style.display).toBe('')
  stop(); off()
})
it('keeps numbers per session, removes and renumbers, and hides sent history', async () => {
  const store = createAnnotationStore(() => 1, null); const open = vi.fn(); const off = registerExternalAnnotations(store, open)
  const add = (sessionId: string, quote: string) => store.add({ sessionId, text: quote, anchorText: quote, anchorKey: undefined, occurrence: 0, note: sessionId, externalSource: { label: 'same', address: 'same' } })
  const a = add('a','one'); const a2 = add('a','two'); const b = add('b','three')
  document.body.innerHTML = '<section data-sidebar-right-session="a"><article data-textpreview-url="same"><p>one two three</p></article></section><section data-sidebar-right-session="b"><article data-textpreview-url="same"><p>one two three</p></article></section>'
  const stop = attachDocumentNotes(); expect([...document.querySelectorAll('[data-paper-margin-document-badge]')].map(node=>node.textContent)).toEqual(['1','2','1'])
  store.remove(a.id); await Promise.resolve(); expect(store.get(a2.id)?.number).toBe(1); expect(store.get(b.id)?.number).toBe(1)
  store.markSent([a2.id]); await Promise.resolve(); expect(document.querySelectorAll('[data-paper-margin-document-badge]')).toHaveLength(1)
  stop(); off()
})

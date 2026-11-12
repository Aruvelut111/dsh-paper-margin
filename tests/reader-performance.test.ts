// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { observeReaderRoots, observeReaderVisibility, readerSessionId } from '../src/client/annotate/reader-surface'
import { readerControls } from '../src/client/viewer/controls'
import { attachDocumentNotes } from '../src/client/annotate/document-notes'
import { createAnnotationStore } from './fixtures/sidenote/src/client/annotations/model'
import { registerExternalAnnotations } from './fixtures/sidenote/src/client/annotations/external'
import { attachUniversalAnnotator } from '../src/client/annotate/universal'

const settle = async () => { await Promise.resolve(); await Promise.resolve() }
it('uses the nearest conversation owner before the outer sidebar owner', () => {
  document.body.innerHTML = '<main data-conversation-session="parent"><aside data-sidebar-right-session="parent"><div id="file"></div><section data-sidenote-chat-session="child"><p id="reply"></p></section><section data-conversation-session="other-child"><p id="other"></p></section></aside></main>'
  expect(readerSessionId(document.querySelector('#reply')!)).toBe('child')
  expect(readerSessionId(document.querySelector('#other')!)).toBe('other-child')
  expect(readerSessionId(document.querySelector('#file')!)).toBe('parent')
})
it('leaves side-chat replies to sidenote instead of adding a second parent toolbar', async () => {
  document.body.innerHTML = '<aside data-sidebar-right-session="parent"><section data-sidenote-chat-session="child"><div data-markdown-variant="chat">side reply</div></section></aside>'
  const capture = vi.fn(); const stop = attachUniversalAnnotator({onAnnotate:capture})
  const range=document.createRange();range.selectNodeContents(document.querySelector('[data-markdown-variant]')!);window.getSelection()?.addRange(range)
  document.dispatchEvent(new MouseEvent('mouseup',{button:0}));await settle()
  expect((document.querySelector('[data-paper-margin-toolbar]') as HTMLElement)?.style.display).toBe('none')
  expect(capture).not.toHaveBeenCalled();stop();window.getSelection()?.removeAllRanges()
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('ignores thousands of text-layer mutations but reacts to ancestor closure and removal', async () => {
  document.body.innerHTML = '<aside data-sidebar-right-panel data-sidebar-right-open><article id="reader"><div class="textLayer"></div></article></aside>'
  const root = document.querySelector('#reader')!; const changed = vi.fn()
  const stop = observeReaderVisibility(root, changed)
  for (let i = 0; i < 1000; i++) { const span = document.createElement('span'); span.style.left = i + 'px'; span.textContent = 'dense page'; root.firstElementChild!.append(span) }
  await settle(); expect(changed).not.toHaveBeenCalled()
  root.parentElement!.removeAttribute('data-sidebar-right-open'); await settle(); expect(changed).toHaveBeenCalledTimes(1)
  root.parentElement!.remove(); await settle(); expect(changed).toHaveBeenCalledTimes(2)
  stop()
})

it('discovers viewer mounts once per frame and ignores unrelated document content', async () => {
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  const scan = vi.fn(); const stop = observeReaderRoots('[data-excel-preview]', scan)
  document.body.innerHTML = '<article class="textLayer"><span>one</span></article>'; await settle()
  expect(scan).not.toHaveBeenCalled()
  const wrapper = document.createElement('div'); wrapper.innerHTML = '<section data-excel-preview></section>'; document.body.append(wrapper)
  await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1)); stop()
})

it('does not rewrite controls when the current page and count have not changed', async () => {
  const view = { numPages: 10000, scroller: document.body, currentPage: () => 1, reveal() {}, zoom() {}, locate: async () => null, flash() {} }
  const controls = readerControls(view); document.body.append(controls.node); controls.refresh()
  let mutations = 0; const observer = new MutationObserver(rows => { mutations += rows.length }); observer.observe(controls.node, { attributes: true, childList: true, subtree: true })
  for (let i = 0; i < 100; i++) controls.refresh()
  await settle(); expect(mutations).toBe(0); observer.disconnect(); controls.dispose()
})

it('projects many long-document notes with one text walk and no work for other panes', async () => {
  const store = createAnnotationStore(() => 1, null); const off = registerExternalAnnotations(store, () => undefined)
  const quotes = Array.from({ length: 40 }, (_, i) => 'unique passage ' + i + ' end')
  for (const quote of quotes) store.add({ sessionId: 's', text: quote, anchorText: quote, anchorKey: undefined, occurrence: 0, note: '', externalSource: { label: 'long', address: 'long' } })
  document.body.innerHTML = '<section data-sidebar-right-session="s"><article data-textpreview-url="long">' + quotes.map(quote => '<p>' + quote + '</p>').join('') + '</article></section><div id="other"></div>'
  const walker = vi.spyOn(document, 'createTreeWalker'); const stop = attachDocumentNotes()
  expect(walker).toHaveBeenCalledTimes(1)
  expect(document.querySelectorAll('[data-paper-margin-document-badge]')).toHaveLength(40)
  const before = walker.mock.calls.length
  document.querySelector('#other')!.textContent = 'unrelated update'; await settle()
  expect(walker).toHaveBeenCalledTimes(before)
  stop(); off()
})

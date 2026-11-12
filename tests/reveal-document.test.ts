// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { attachExternalReveal } from '../src/client/annotate/reveal'
import { PdfViewRegistry } from '../src/client/viewer/registry'
afterEach(() => document.body.replaceChildren())
it('waits for the target session document text before revealing', async () => {
  const address = 'dsh-resource://file/session/a/book.md'; const open = vi.fn(); const notify = vi.fn(); const scroll = vi.fn(); const focus = vi.fn()
  document.body.innerHTML = '<section data-sidebar-right-session="b"><article><p>target quote</p></article></section><section data-sidebar-right-session="a"></section>'
  document.querySelector('article')!.setAttribute('data-textpreview-url', address)
  const off = attachExternalReveal(new PdfViewRegistry(), open, notify); document.addEventListener('dsh-paper-margin:document-focus', focus)
  document.dispatchEvent(new CustomEvent('dsh-sidenote:reveal-external:v1', { detail: { sessionId: 'a', text: 'target quote', source: { address } } }))
  const target = document.querySelector('section:last-child')!; target.innerHTML = '<article><header>book.md</header></article>'; target.querySelector('article')!.setAttribute('data-textpreview-url', address); await Promise.resolve()
  expect(focus).not.toHaveBeenCalled()
  const p = document.createElement('p'); p.textContent = 'target quote'; p.scrollIntoView = scroll; target.querySelector('article')!.append(p); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(open).toHaveBeenCalledWith(address); expect(scroll).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce(); expect(notify).not.toHaveBeenCalled()
  off(); document.removeEventListener('dsh-paper-margin:document-focus', focus)
})

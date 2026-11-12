// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

import { annotationHtml } from '../src/client/viewer/html-preview'
import { selectedExcelText } from '../src/client/annotate/excel'
import { PdfViewRegistry } from '../src/client/viewer/registry'
import type { PdfViewImpl } from '../src/client/viewer/pdf-view'

afterEach(() => { document.body.replaceChildren() })
it('keeps HTML opaque, sanitizes document code, and adds one nonce-bound annotation script', () => {
  const html = annotationHtml('<h1 onclick="alert(1)">Title</h1><script>evil()</script><iframe src="http://local"></iframe><a href="javascript:evil()">safe text</a><style>h1{color:red}</style>', 'abc123')
  const doc = new DOMParser().parseFromString(html, 'text/html')
  expect(doc.querySelectorAll('script')).toHaveLength(1); expect(doc.querySelector('script')?.getAttribute('nonce')).toBe('abc123')
  expect(doc.querySelector('iframe')).toBeNull(); expect(doc.querySelector('h1')?.hasAttribute('onclick')).toBe(false); expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false)
  expect(doc.querySelector('meta')?.content).toContain("script-src 'nonce-abc123'"); expect(html).not.toContain('evil()'); expect(html).toContain('h1{color:red}')
})
it('captures FortuneSheet native table projection without reading or replacing the clipboard', () => {
  sessionStorage.setItem('localClipboard', 'user clipboard cache')
  const root = document.createElement('section'); root.innerHTML = '<div class="fortune-container"></div>'; document.body.append(root)
  const grid = root.firstElementChild!
  grid.addEventListener('keydown', () => {
    const buffer = document.createElement('div'); buffer.id = 'fortune-copy-content'; buffer.innerHTML = '<table><tr><td>项目</td><td>金额</td></tr><tr><td>A</td><td>12</td></tr></table>'; grid.append(buffer)
    const event = new Event('copy', { bubbles: true, cancelable: true }); buffer.dispatchEvent(event); sessionStorage.setItem('localClipboard', 'projected table'); expect(event.defaultPrevented).toBe(true)
  })
  expect(selectedExcelText(root)).toBe('项目\t金额\nA\t12')
  expect(sessionStorage.getItem('localClipboard')).toBe('user clipboard cache')
})
it('resolves full paths, refuses ambiguous filenames, and protects same-tick replacement registrations', async () => {
  const registry = new PdfViewRegistry(); const view = {} as PdfViewImpl; vi.spyOn(Date, 'now').mockReturnValue(1)
  const old = registry.add('a', 'same.pdf', 'dsh-resource://file/session/s/one/same.pdf', view)
  registry.add('b', 'same.pdf', 'dsh-resource://file/session/s/two/same.pdf', view)
  expect(registry.find('same.pdf')).toBeUndefined(); expect(registry.find('one/same.pdf')?.key).toBe('a')
  registry.add('a', 'same.pdf', 'dsh-resource://file/session/s/one/same.pdf', view); old(); expect(registry.find('one/same.pdf')).toBeDefined()
  const ready = registry.waitFor('three/same.pdf'); registry.add('c', 'same.pdf', 'dsh-resource://file/session/s/three/same.pdf', view); expect((await ready)?.key).toBe('c'); vi.restoreAllMocks()
})

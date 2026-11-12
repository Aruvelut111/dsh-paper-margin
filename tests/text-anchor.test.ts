// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { captureTextAnchor, resolveTextAnchor } from '../src/client/annotate/text-anchor'
it('restores the selected duplicate after remount and preceding edits', () => {
  const root = document.createElement('article'); root.innerHTML = '<p>first repeated quote after A</p><p>second repeated quote after B</p>'
  const node = root.lastElementChild!.firstChild!; const range = document.createRange(); range.setStart(node, 7); range.setEnd(node, 21)
  const anchor = captureTextAnchor(root, range)!
  expect(anchor.exact).toBe('repeated quote')
  root.innerHTML = '<p>inserted heading</p>' + root.innerHTML
  expect(resolveTextAnchor(root, 'repeated quote', anchor)?.startContainer).toBe(root.lastElementChild!.firstChild)
  expect(resolveTextAnchor(root, 'repeated quote')).toBeUndefined()
})
it('supports cross-node text and never trusts an obsolete position', () => {
  const root = document.createElement('article'); root.innerHTML = '<p>hello <b>world</b>!</p>'
  const range = document.createRange(); range.setStart(root.querySelector('p')!.firstChild!, 2); range.setEnd(root.querySelector('b')!.firstChild!, 3)
  const anchor = captureTextAnchor(root, range)!
  root.innerHTML = '<p>preface</p><p>hello <strong>world</strong>!</p>'
  expect(resolveTextAnchor(root, 'llo wor', anchor)?.toString()).toBe('llo wor')
  root.textContent = 'unrelated replacement'; expect(resolveTextAnchor(root, 'llo wor', anchor)).toBeUndefined()
})
it('excludes host file paths and isolated HTML helper text from quote matching', () => {
  const root = document.createElement('article'); root.dataset.textpreviewUrl = 'book.md'; root.innerHTML = '<header>book.md</header><div data-textpreview-body><p>real source text</p></div>'
  expect(resolveTextAnchor(root, 'book.md')).toBeUndefined(); expect(resolveTextAnchor(root, 'real source text')?.toString()).toBe('real source text')
  root.innerHTML = '<div data-textpreview-body><p>HTML helper text.</p><iframe></iframe></div>'; expect(resolveTextAnchor(root, '.')).toBeUndefined()
})

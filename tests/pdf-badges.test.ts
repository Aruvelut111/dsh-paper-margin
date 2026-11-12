// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { attachPdfBadges } from '../src/client/annotate/pdf-badges'
import type { PdfViewImpl } from '../src/client/viewer/pdf-view'

it('restores saved PDF marks after page replacement and removes all projections on disposal', async () => {
  const root = document.createElement('section'); root.innerHTML = '<div data-paper-margin-page="2"></div>'; document.body.append(root)
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  let state = 'active'
  const receive = (event: Event) => { (event as CustomEvent).detail.reply({ items: [{ id: 7, number: 1, state, anchorText: 'quote', note: 'kept', externalSource: { address: 'book', page: 2 } }] }) }
  document.addEventListener('dsh-sidenote:external-annotation:v1', receive)
  const locate = vi.fn(async () => ({ page: 2, boxes: [{ x: .1, y: .2, w: .3, h: .04 }] }))
  const stop = attachPdfBadges(root, { locate } as unknown as PdfViewImpl, 'book', 's')
  try {
    await vi.waitFor(() => expect(root.querySelectorAll('[data-paper-margin-badge]')).toHaveLength(1))
    expect(root.querySelectorAll('[data-paper-margin-saved-mark]')).toHaveLength(1)
    root.innerHTML = '<div data-paper-margin-page="2"></div>'
    await vi.waitFor(() => expect(root.querySelectorAll('[data-paper-margin-saved-mark]')).toHaveLength(1))
    expect(root.querySelector('[data-paper-margin-badge]')?.getAttribute('title')).toContain('kept')
    expect((root.querySelector('[data-paper-margin-badge]') as HTMLElement).style.background).toBe('rgb(47, 136, 255)')
    expect((root.querySelector('[data-paper-margin-saved-mark]') as HTMLElement).style.background).toBe('rgba(47, 136, 255, 0.18)')
    state = 'sent'; document.dispatchEvent(new Event('dsh-sidenote:external-annotations-changed'))
    await vi.waitFor(() => expect(root.querySelector('[data-paper-margin-badge], [data-paper-margin-saved-mark]')).toBeNull())
  } finally { stop(); document.removeEventListener('dsh-sidenote:external-annotation:v1', receive); vi.unstubAllGlobals() }
  expect(root.querySelector('[data-paper-margin-badge], [data-paper-margin-saved-mark]')).toBeNull(); root.remove()
})

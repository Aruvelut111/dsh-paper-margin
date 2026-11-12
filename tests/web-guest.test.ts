import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
it('executes the minified serialized guest, preserves typed notes, and does not ack newer edits', async () => {
  const compiled = await build({ entryPoints: ['src/client/annotate/web.ts'], bundle: true, write: false, format: 'iife', globalName: 'Guest', minify: true, platform: 'browser', target: 'es2022' })
  const dom = new JSDOM('<body><p>selected passage</p></body>', { url: 'https://example.test/page', runScripts: 'dangerously', pretendToBeVisual: true })
  const win = dom.window
  const serialized = win.eval(compiled.outputFiles[0]!.text + ';Guest.installGuestOverlay.toString()')
  win.eval('(' + serialized + ')(window)')
  const range = win.document.createRange(); range.selectNodeContents(win.document.querySelector('p')!); (range as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect = () => new win.DOMRect(10, 10, 60, 20)
  win.getSelection()!.addRange(range); win.document.dispatchEvent(new win.MouseEvent('mouseup'))
  win.document.querySelector('button')!.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  const input = win.document.querySelector('textarea')!; input.value = 'first <tag>'; input.dispatchEvent(new win.Event('input'))
  const api = (win as unknown as { __paperMarginGuest: { peek(): Array<{ id: string; revision: number; note: string }>; ack(ids: string[]): void; dispose(): Array<{ note: string }> } }).__paperMarginGuest
  const first = api.peek()[0]!; input.value = 'second 任意文字'; input.dispatchEvent(new win.Event('input')); api.ack([first.id + ':' + first.revision])
  expect(api.peek()[0]?.note).toBe('second 任意文字')
  const result = api.dispose(); expect(result[0]?.note).toBe('second 任意文字'); expect(win.document.querySelector('textarea')).toBeNull(); dom.window.close()
})
it('restores numbered guest notes, edits the existing capture, and removes sent projections', async () => {
  const compiled = await build({ entryPoints: ['src/client/annotate/web.ts'], bundle: true, write: false, format: 'iife', globalName: 'Guest', minify: true, platform: 'browser', target: 'es2022' })
  const dom = new JSDOM('<body><p>selected passage</p></body>', { url: 'https://example.test/page', runScripts: 'dangerously', pretendToBeVisual: true })
  const win = dom.window; win.eval(compiled.outputFiles[0]!.text + ';Guest.installGuestOverlay(window)')
  win.Range.prototype.getClientRects = () => [new win.DOMRect(10, 10, 100, 20)] as unknown as DOMRectList
  const api = (win as unknown as { __paperMarginGuest: { setNotes(notes: unknown[]): void; peek(): Array<{ id: string; note: string }>; dispose(): unknown } }).__paperMarginGuest
  const saved = { id: 3, number: 2, anchorText: 'selected passage', note: 'persisted arbitrary comment', state: 'active', externalCaptureId: 'stable-id' }
  api.setNotes([saved]); await new Promise(resolve => setTimeout(resolve, 35))
  const badge = win.document.querySelector<HTMLButtonElement>('[data-paper-margin-guest-badge]')!; expect(badge.textContent).toBe('2'); badge.click()
  const input = win.document.querySelector('textarea')!; expect(input.value).toBe(saved.note); input.value = 'edited'; input.dispatchEvent(new win.Event('input')); expect(api.peek()[0]).toMatchObject({ id: 'stable-id', note: 'edited' })
  ;[...win.document.querySelectorAll<HTMLButtonElement>('section button')].find(button => button.textContent === '完成')!.click()
  api.setNotes([{ ...saved, state: 'sent', note: 'sent snapshot' }]); await new Promise(resolve => setTimeout(resolve, 35))
  expect(win.document.querySelector('[data-paper-margin-guest-badge]')).toBeNull()
  expect(api.peek()).toHaveLength(0)
  api.dispose(); dom.window.close()
})
it('queues deletion for an unacknowledged capture and closes a removed live editor', async () => {
  const compiled = await build({ entryPoints: ['src/client/annotate/web.ts'], bundle: true, write: false, format: 'iife', globalName: 'Guest', minify: true, platform: 'browser', target: 'es2022' })
  const dom = new JSDOM('<body><p>selected passage</p></body>', { url: 'https://example.test/page', runScripts: 'dangerously', pretendToBeVisual: true }); const win = dom.window
  win.eval(compiled.outputFiles[0]!.text + ';Guest.installGuestOverlay(window)')
  const api = (win as unknown as { __paperMarginGuest: { setNotes(notes: unknown[]): void; peek(): Array<{ id: string; revision: number; remove?: boolean }>; ack(ids: string[]): void; suspend(): void; dispose(): unknown } }).__paperMarginGuest
  const range = win.document.createRange(); range.selectNodeContents(win.document.querySelector('p')!); (range as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect = () => new win.DOMRect(10, 10, 60, 20)
  win.getSelection()!.addRange(range); win.document.dispatchEvent(new win.MouseEvent('mouseup')); win.document.querySelector('button')!.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  const first = api.peek()[0]!; win.document.querySelector<HTMLButtonElement>('[aria-label=删除批注]')!.click()
  expect(api.peek()).toMatchObject([{ id: first.id, remove: true }]); expect(win.document.querySelector('textarea')).toBeNull()
  api.ack([first.id + ':' + first.revision]); expect(api.peek()).toHaveLength(1)
  const deletion = api.peek()[0]!; api.ack([deletion.id + ':' + deletion.revision]); expect(api.peek()).toHaveLength(0)
  win.Range.prototype.getClientRects = () => [new win.DOMRect(10, 10, 100, 20)] as unknown as DOMRectList
  api.setNotes([{ id: 7, number: 1, anchorText: 'selected passage', note: 'saved', state: 'active', externalCaptureId: first.id }]); await new Promise(resolve => setTimeout(resolve, 35))
  win.document.querySelector<HTMLButtonElement>('[data-paper-margin-guest-badge]')!.click(); expect(win.document.querySelector('textarea')).not.toBeNull()
  api.setNotes([]); expect(win.document.querySelector('textarea')).toBeNull(); expect(api.peek()).toHaveLength(0)
  api.suspend(); api.dispose(); expect(api.peek()).toHaveLength(0); dom.window.close()
})

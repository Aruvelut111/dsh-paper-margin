// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { attachWebAnnotations } from '../src/client/annotate/web'
import { createAnnotationStore } from './fixtures/sidenote/src/client/annotations/model'
import { registerExternalAnnotations } from './fixtures/sidenote/src/client/annotations/external'
import { captureInSidenote } from '../src/client/annotate/sidenote'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it('bridges native webview drafts, navigation restore, sending, closing and session ownership', async () => {
  const guest = new JSDOM('<body><p>same passage</p></body>',{url:'https://example.test/article',runScripts:'dangerously',pretendToBeVisual:true})
  const win = guest.window
  win.Range.prototype.getClientRects = () => [new win.DOMRect(10,20,100,18)] as unknown as DOMRectList
  win.Range.prototype.getBoundingClientRect = () => new win.DOMRect(10,20,100,18)
  document.body.innerHTML = '<aside data-sidebar-right-panel data-sidebar-right-open data-sidebar-right-session="owner"><webview data-sidebar-browser-frame></webview></aside>'
  const frame = document.querySelector('webview')! as HTMLElement & {executeJavaScript(code:string):Promise<unknown>;getURL():string}
  frame.executeJavaScript = async code => win.eval(code)
  frame.getURL = () => win.location.href
  win.console.debug = message => {const event = new Event('console-message');Object.assign(event,{message});frame.dispatchEvent(event)}
  const store = createAnnotationStore(() => 1, null)
  const off = registerExternalAnnotations(store, () => undefined)
  const captures: Array<{sessionId:string;sourceAddress:string;quote:string;note:string}> = []
  const stop = attachWebAnnotations(item => {
    const capture = item as {id:string;sessionId:string;sourceAddress:string;quote:string;note:string;anchor:never}
    captures.push(capture)
    captureInSidenote({id:capture.id,sessionId:capture.sessionId,text:capture.quote,note:capture.note,source:{label:'page',address:capture.sourceAddress,anchor:capture.anchor},edit:false})
  })
  await vi.waitFor(() => expect(frame.dataset.paperMarginWebStatus).toBe('ready'))
  const range=win.document.createRange();range.selectNodeContents(win.document.querySelector('p')!);win.getSelection()!.addRange(range)
  win.document.dispatchEvent(new win.MouseEvent('mouseup'))
  win.document.querySelector<HTMLButtonElement>('[data-paper-margin-web]')!.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true,cancelable:true}))
  const input=win.document.querySelector('textarea')!;input.value='arbitrary comment';input.dispatchEvent(new win.Event('input'))
  await vi.waitFor(() => expect(store.listActive('owner')[0]?.note).toBe('arbitrary comment'))
  expect(captures.every(item=>item.sessionId==='owner')).toBe(true)
  expect(store.list('other')).toHaveLength(0)
  const api = () => (win as unknown as {__paperMarginGuest:{dispose():unknown}}).__paperMarginGuest
  api().dispose();frame.dispatchEvent(new Event('dom-ready'))
  await vi.waitFor(() => expect(win.document.querySelector('[data-paper-margin-guest-badge]')?.textContent).toBe('1'))
  document.querySelector('aside')!.removeAttribute('data-sidebar-right-open')
  await vi.waitFor(() => expect(win.document.querySelectorAll('textarea')).toHaveLength(0))
  expect(win.getSelection()?.toString()).toBe('')
  document.querySelector('aside')!.setAttribute('data-sidebar-right-open','')
  await vi.waitFor(() => expect((win.document.querySelector('div[data-paper-margin-web]') as HTMLElement).style.display).toBe(''))
  store.markSent(store.listActive('owner').map(note=>note.id))
  await vi.waitFor(() => expect(win.document.querySelector('[data-paper-margin-guest-badge]')).toBeNull())
  const oldApi = api()
  document.querySelector('aside')!.setAttribute('data-sidebar-right-session', 'other')
  await vi.waitFor(() => expect(api()).not.toBe(oldApi))
  const nextRange = win.document.createRange(); nextRange.selectNodeContents(win.document.querySelector('p')!); win.getSelection()!.addRange(nextRange)
  win.document.dispatchEvent(new win.MouseEvent('mouseup'))
  win.document.querySelector<HTMLButtonElement>('[data-paper-margin-web]')!.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true,cancelable:true}))
  const nextInput = win.document.querySelector('textarea')!; nextInput.value = 'new owner only'; nextInput.dispatchEvent(new win.Event('input'))
  await vi.waitFor(() => expect(store.listActive('other')[0]?.note).toBe('new owner only'))
  expect(store.listActive('owner')).toHaveLength(0)
  stop(); off(); guest.window.close()
})

import type { CapturedSelection } from './universal'
import { documentNotes } from './document-notes'
import type { TextAnchor } from './text-anchor'
import { removeFromSidenote } from './sidenote'
import { readerSessionId, readerSurfaceVisible, observeReaderVisibility, observeReaderRoots } from './reader-surface'
interface GuestItem { id: string; revision?: number; quote: string; note: string; url: string; title: string; image?: boolean; anchor?: TextAnchor; removeId?: number; remove?: boolean }
interface GuestSaved { id: number; number: number; anchorText: string; note: string; state: string; externalCaptureId?: string; externalSource?: { anchor?: TextAnchor } }
interface GuestApi { peek(): GuestItem[]; ack(ids: string[]): void; setNotes(notes: GuestSaved[]): void; suspend(): void; resume(): void; reveal(text: string, anchor?: TextAnchor): boolean; dispose(): GuestItem[] }
type GuestWindow = Window & { __paperMarginGuest?: GuestApi }

/** Self-contained: serialized into a desktop guest, without importing host code. */
export function installGuestOverlay(win: GuestWindow, changed?: () => void): void {
  if (win.__paperMarginGuest) return
  const doc = win.document
  const items: GuestItem[] = []
  let nextRevision = 0
  const button = doc.createElement('button')
  button.type = 'button'; button.textContent = '添加到对话'; button.setAttribute('data-paper-margin-web', '')
  Object.assign(button.style, { position: 'fixed', display: 'none', zIndex: '2147483646', background: '#26344a', color: 'white', padding: '7px 12px', border: '1px solid #9baac0', borderRadius: '6px', cursor: 'pointer', font: '13px sans-serif' })
  doc.body.append(button)
  let quote = ''; let image = false; let anchor: TextAnchor | undefined; let selectedNote: GuestSaved | undefined
  let saved: GuestSaved[] = []; let savedSignature = ''; let drawFrame = 0; let suspended = false
  const layer = doc.createElement('div'); layer.dataset.paperMarginWeb = ''; layer.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none'; doc.body.append(layer)
  const textNodes = () => {
    const walker = doc.createTreeWalker(doc.body, 4, { acceptNode: node => node.parentElement?.closest('button,textarea,input,script,style,[data-paper-margin-web]') ? 2 : 1 })
    const nodes: Text[] = []; let text = ''; let node: Node | null
    while ((node = walker.nextNode())) { nodes.push(node as Text); text += node.textContent ?? '' }
    return { nodes, text }
  }
  let projection: ReturnType<typeof textNodes> | undefined
  const ranges = new Map<number, Range>()
  const resolve = (quote: string, selector?: TextAnchor): Range | undefined => {
    const { nodes, text } = projection ??= textNodes(); const exact = selector?.exact || quote; if (!exact.trim()) return
    const matches: number[] = []; for (let at = text.indexOf(exact); at >= 0; at = text.indexOf(exact, at + 1)) matches.push(at)
    const context = selector ? matches.filter(at => text.slice(Math.max(0, at - selector.prefix.length), at) === selector.prefix && text.slice(at + exact.length, at + exact.length + selector.suffix.length) === selector.suffix) : []
    const start = context.length === 1 ? context[0] : matches.length === 1 ? matches[0] : undefined; if (start === undefined) return
    const end = start + exact.length; const range = doc.createRange(); let offset = 0
    for (const node of nodes) { const next = offset + node.length; if (offset <= start && start < next) range.setStart(node, start - offset); if (offset < end && end <= next) { range.setEnd(node, end - offset); return range }; offset = next }
  }
  const reveal = (text: string, anchor?: TextAnchor): boolean => { const range = resolve(text, anchor); if (!range) return false; range.startContainer.parentElement?.scrollIntoView?.({ block: 'center' }); scheduleDraw(); return true }
  const draw = () => {
    drawFrame = 0
    if (suspended) return
    // Resolve text once per content revision. Scrolling only measures cached
    // ranges; overlay writes happen after every range has been measured.
    const plans = saved.map(note => {
      let range = ranges.get(note.id)
      if (!range?.startContainer.isConnected || !range.endContainer.isConnected) range = resolve(note.anchorText, note.externalSource?.anchor)
      if (range) ranges.set(note.id, range)
      return {note, rects: range && typeof range.getClientRects === 'function' ? [...range.getClientRects()] : []}
    })
    layer.replaceChildren(); let previous = -24
    for (const {note, rects} of plans) {
      const rect = rects.find(rect => rect.bottom > 0 && rect.top < win.innerHeight); if (!rect) continue
      for (const rect of rects) { const mark = doc.createElement('span'); mark.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:#2f88ff22;pointer-events:none`; layer.append(mark) }
      const badge = doc.createElement('button'); badge.type = 'button'; badge.dataset.paperMarginGuestBadge = String(note.id); badge.textContent = String(note.number); badge.title = note.anchorText + '\n' + note.note; badge.setAttribute('aria-label', `查看阅读批注 ${note.number}`)
      const top = Math.max(2, rect.top, previous + 23); if (top + 20 > win.innerHeight) continue; previous = top
      badge.style.cssText = `position:fixed;right:5px;top:${top}px;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:#2f88ff;color:white;font:600 11px sans-serif;cursor:pointer;pointer-events:auto`
      badge.addEventListener('click', event => { selectedNote = note; quote = note.anchorText; anchor = note.externalSource?.anchor; image = false; show(win.innerWidth - 330, top); capture(event) }); layer.append(badge)
    }
  }
  const scheduleDraw = () => { if (!drawFrame) drawFrame = win.requestAnimationFrame(draw) }
  let editor: HTMLElement | undefined
  let editorCaptureId: string | undefined
  let saveEditor: (() => void) | undefined
  let discardEditor: (() => void) | undefined
  const show = (x: number, y: number) => {
    button.style.display = 'block'; button.style.left = `${Math.max(8, Math.min(x, win.innerWidth - 170))}px`; button.style.top = `${Math.max(8, Math.min(y + 6, win.innerHeight - 42))}px`
  }
  const select = () => {
    const selection = win.getSelection(); const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
    const parent = range?.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer as Element : range?.commonAncestorContainer.parentElement
    if (!range || !selection || selection.isCollapsed || parent?.closest('textarea,input,[contenteditable], [data-paper-margin-web]')) { button.style.display = 'none'; return }
    quote = selection.toString(); image = false; selectedNote = undefined; anchor = undefined
    const content = projection ??= textNodes(); let offset = 0; let start = -1; let end = -1
    for (const node of content.nodes) { if (node === range.startContainer) start = offset + range.startOffset; if (node === range.endContainer) end = offset + range.endOffset; offset += node.length }
    if (start >= 0 && end > start) anchor = { exact: content.text.slice(start, end), start, prefix: content.text.slice(Math.max(0, start - 48), start), suffix: content.text.slice(end, end + 48) }
    if (!quote.trim()) return
    const rect = range.getBoundingClientRect(); show(rect.left, rect.bottom)
  }
  const context = (event: MouseEvent) => {
    if (!event.altKey) return
    const target = event.target as Element | null; const img = target?.closest?.('img')
    if (!img) return
    quote = img.alt || '网页图片（整图批注）'; image = true; anchor = undefined; selectedNote = undefined; show(event.clientX, event.clientY)
  }
  const capture = (event: Event) => {
    event.preventDefault(); if (!quote) return
    saveEditor?.()
    const item = { id: selectedNote?.externalCaptureId ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`, quote, url: win.location.href, title: doc.title, image, anchor }
    const box = doc.createElement('section'); box.setAttribute('data-paper-margin-web', ''); box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '就地写批注')
    Object.assign(box.style, { position: 'fixed', zIndex: '2147483647', left: button.style.left, top: button.style.top, width: 'min(320px, calc(100vw - 24px))', background: '#fff', color: '#222', padding: '10px', border: '1px solid #888', borderRadius: '8px', boxShadow: '0 4px 20px #0004', font: '13px sans-serif' })
    const preview = doc.createElement('blockquote'); preview.textContent = quote; Object.assign(preview.style, { maxHeight: '70px', overflow: 'auto', margin: '0 0 8px', whiteSpace: 'pre-wrap' })
    const input = doc.createElement('textarea'); input.setAttribute('aria-label', '就地批注'); input.placeholder = '写批注… Enter 确认，Shift+Enter 换行'; input.rows = 3; input.style.width = '100%'; input.style.boxSizing = 'border-box'
    input.value = selectedNote?.note ?? ''
    const readonly = selectedNote?.state === 'sent'; input.readOnly = readonly
    const confirm = doc.createElement('button'); confirm.type = 'button'; confirm.textContent = '完成'
    const selectedId = selectedNote?.id
    const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.setAttribute('aria-label', '删除批注')
    remove.addEventListener('click', () => {
      discardEditor?.()
      for (let index = items.length - 1; index >= 0; index--) if (items[index]!.id === item.id) items.splice(index, 1)
      items.push({ ...item, revision: ++nextRevision, note: input.value, remove: true, removeId: selectedId })
      changed?.()
      saved = saved.filter(note => note.id !== selectedId); selectedNote = undefined; scheduleDraw()
    })
    let composing = false; let done = false
    const queueNote = () => { if (readonly) return; const previous = items.findIndex(record => record.id === item.id); const record = { ...item, revision: ++nextRevision, note: input.value }; if (previous < 0) items.push(record); else items[previous] = record; changed?.() }
    const outside = (event: Event) => { if (!box.contains(event.target as Node)) save() }
    const save = () => {
      if (done) return; queueNote(); discardEditor?.()
    }
    discardEditor = () => { done = true; doc.removeEventListener('mousedown', outside, true); box.remove(); editor = undefined; editorCaptureId = undefined; saveEditor = undefined; discardEditor = undefined }
    input.addEventListener('compositionstart', () => { composing = true }); input.addEventListener('compositionend', () => { composing = false })
    input.addEventListener('input', queueNote)
    queueNote()
    input.addEventListener('keydown', event => { if ((event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !composing) || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); save() } })
    confirm.addEventListener('click', save); box.append(preview, input, remove, confirm); doc.body.append(box); doc.addEventListener('mousedown', outside, true); editor = box; editorCaptureId = item.id; saveEditor = save; input.focus()
    button.style.display = 'none'; quote = ''; win.getSelection()?.removeAllRanges()
  }
  const hide = () => { button.style.display = 'none'; scheduleDraw() }
  const Observer = (win as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
  const contentObserver = new Observer(records => {
    if (records.every(record => (record.target.nodeType === 1 ? record.target as Element : record.target.parentElement)?.closest('[data-paper-margin-web]'))) return
    // Ignore the insertion/removal of our root controls too.
    if (records.every(record => record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node.nodeType === 1 && (node as Element).matches('[data-paper-margin-web]')))) return
    projection = undefined; ranges.clear()
    if (saved.length) scheduleDraw()
  })
  contentObserver.observe(doc.body, {subtree:true, childList:true, characterData:true})
  const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); else if (event.shiftKey) select() }
  const click = (event: MouseEvent) => { if (event.detail === 0) capture(event) }
  doc.addEventListener('mouseup', select); doc.addEventListener('contextmenu', context); doc.addEventListener('keyup', keyboard); win.addEventListener('scroll', hide, true); win.addEventListener('resize', scheduleDraw)
  button.addEventListener('mousedown', capture); button.addEventListener('click', click)
  win.__paperMarginGuest = {
    peek: () => items.slice(),
    setNotes: notes => {
      const active = notes.filter(note => note.state === 'active')
      const retired = new Set(saved.filter(note => !active.some(current => current.id === note.id)).map(note => note.externalCaptureId).filter(Boolean))
      for (let index = items.length - 1; index >= 0; index--) if (!items[index]!.remove && retired.has(items[index]!.id)) items.splice(index, 1)
      if (editorCaptureId && retired.has(editorCaptureId) || selectedNote && !active.some(note => note.id === selectedNote!.id)) { discardEditor?.(); selectedNote = undefined }
      const signature = JSON.stringify(active); if (signature !== savedSignature) { savedSignature = signature; saved = active; ranges.clear(); scheduleDraw() }
    },
    reveal,
    suspend: () => { suspended = true; saveEditor?.(); button.style.display = 'none'; layer.style.display = 'none'; win.getSelection()?.removeAllRanges() },
    resume: () => { if (suspended) { suspended = false; layer.style.display = ''; scheduleDraw() } },
    ack: ids => { for (let i = items.length - 1; i >= 0; i--) if (ids.includes(items[i]!.id + ':' + (items[i]!.revision ?? 0))) items.splice(i, 1) },
    dispose: () => { contentObserver.disconnect(); saveEditor?.(); editor?.remove(); doc.removeEventListener('mouseup', select); doc.removeEventListener('contextmenu', context); doc.removeEventListener('keyup', keyboard); win.removeEventListener('scroll', hide, true); win.removeEventListener('resize', scheduleDraw); win.cancelAnimationFrame(drawFrame); layer.remove(); button.remove(); ranges.clear(); projection = undefined; delete win.__paperMarginGuest; return items.slice() },
  }
}

interface Webview extends HTMLElement { executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>; getURL?(): string }
/** The bridge only reads explicit captures; a note is acknowledged after storage. */
export function attachWebAnnotations(onCapture: (capture: CapturedSelection) => string | object | undefined, open?: (address: string) => void): () => void {
  const watched = new Map<Element, { busy: boolean; again?: boolean; owner?: string; signal: string; signature?: string; ready: () => void; dispose: () => void; notice?: HTMLElement }>()
  let stopped = false
  const persist = (element: Element, records: GuestItem[], owner = watched.get(element)?.owner) => {
    const ids: string[] = []
    for (const item of records) {
      if (!item || typeof item.quote !== 'string' || typeof item.url !== 'string' || typeof item.id !== 'string') continue
      const sessionId = owner
      if (!sessionId) continue
      if (item.remove || item.removeId !== undefined) { if (removeFromSidenote(sessionId, item.removeId, item.id)) ids.push(item.id + ':' + (item.revision ?? 0)); continue }
      const result = onCapture({ id: item.id, sessionId, kind: item.image ? 'image' : 'web', file: item.title || item.url, sourceAddress: item.url, quote: item.quote, note: item.note || '', anchor: item.anchor, where: item.image ? '网页图片' : '网页划选' }); if (typeof result !== 'string') ids.push(item.id + ':' + (item.revision ?? 0))
    }
    return ids
  }
  const tick = async (element: Element) => {
    const state = watched.get(element); if (!state || stopped) return
    if (state.busy) { state.again = true; return }
    state.busy = true
    try {
      if (readerSessionId(element) !== state.owner) { state.dispose(); watched.delete(element); queueMicrotask(scan); return }
      let api: GuestApi | undefined; let records: GuestItem[]; let url: string
      const visible = readerSurfaceVisible(element)
      if (element.tagName.toLowerCase() === 'webview') {
        const webview = element as Webview
        const source = `(${installGuestOverlay.toString()})(window,()=>console.debug(${JSON.stringify(state.signal)}));`
        const response = await webview.executeJavaScript(`(()=>{${source} const api=window.__paperMarginGuest;api.${visible ? 'resume' : 'suspend'}();return {items:api.peek(),url:location.href}})()`, false) as {items:GuestItem[];url:string}
        records = response.items; url = response.url
      } else {
        const win = (element as HTMLIFrameElement).contentWindow as GuestWindow | null
        if (!win?.document.body) return
        installGuestOverlay(win, () => queueMicrotask(() => void tick(element))); api = win.__paperMarginGuest
        if (visible) api?.resume(); else api?.suspend()
        records = api?.peek() ?? []; url = win.location.href
      }
      if (!Array.isArray(records)) return
      if (watched.get(element) !== state || stopped || readerSessionId(element) !== state.owner) return
      const ids = persist(element, api?.peek() ?? records, state.owner)
      const notes = state.owner && url ? documentNotes(state.owner, url) : []
      const signature = JSON.stringify([url, notes])
      if (signature !== state.signature) {
        if (api) api.setNotes(notes)
        else await (element as Webview).executeJavaScript(`location.href===${JSON.stringify(url)}&&window.__paperMarginGuest?.setNotes(${JSON.stringify(notes)})`, false)
        state.signature = signature
      }
      if (ids.length) {
        if (api) api.ack(ids)
        else await (element as Webview).executeJavaScript(`location.href===${JSON.stringify(url)}&&window.__paperMarginGuest?.ack(${JSON.stringify(ids)})`, false)
      }
      element.setAttribute('data-paper-margin-web-status', 'ready')
      state.notice?.remove(); state.notice = undefined
    } catch {
      element.setAttribute('data-paper-margin-web-status', 'unavailable')
      if (!state.notice && element.isConnected) {
        const notice = document.createElement('p'); notice.setAttribute('role', 'status'); notice.dataset.paperMarginWebNotice = ''; notice.style.cssText = 'font:12px sans-serif;padding:6px 10px;margin:0;flex:none'
        notice.textContent = element.matches('[data-html-preview]') ? '此内置 HTML 查看器不开放选区。可在「打开方式」中选择「HTML 批注阅读」。' : '此网页的安全隔离阻止就地批注；原网页功能仍可使用。'
        element.parentElement?.insertBefore(notice, element); state.notice = notice
      }
    }
    finally { state.busy = false; if (state.again && !stopped && watched.get(element) === state) { state.again = false; queueMicrotask(() => void tick(element)) } }
  }
  const scan = () => {
    for (const [element, state] of watched) if (!element.isConnected) { state.dispose(); watched.delete(element) }
    for (const element of document.querySelectorAll('webview[data-sidebar-browser-frame], iframe[data-sidebar-browser-frame], iframe[data-html-preview]')) {
      if (!watched.has(element)) {
        const ready = () => { const state = watched.get(element); if (state) state.signature = undefined; void tick(element) }
        const signal = 'paper-margin-dirty:' + crypto.randomUUID()
        // Only an opaque wake-up signal crosses the guest console. Notes and
        // page contents are read from the leased webview, never logged.
        const dirty = (event: Event) => { const message = (event as Event & { message?: string; details?: {message?: string} }); if ((message.message ?? message.details?.message) === signal) queueMicrotask(() => void tick(element)) }
        element.addEventListener('dom-ready', ready); element.addEventListener('load', ready)
        element.addEventListener('console-message', dirty)
        const owner = readerSessionId(element)
        const visibility = observeReaderVisibility(element, () => void tick(element))
        watched.set(element, { busy: false, owner, signal, ready, dispose: () => {
          visibility()
          watched.get(element)?.notice?.remove()
          element.removeEventListener('dom-ready', ready); element.removeEventListener('load', ready)
          element.removeEventListener('console-message', dirty)
          try {
            if (element.tagName.toLowerCase() === 'webview') void (element as Webview).executeJavaScript('window.__paperMarginGuest?.dispose() ?? []', false).then(items => { if (Array.isArray(items)) persist(element, items, owner) }).catch(() => undefined)
            else { const items = ((element as HTMLIFrameElement).contentWindow as GuestWindow | null)?.__paperMarginGuest?.dispose(); if (items) persist(element, items, owner) }
          } catch { /* navigating or cross-origin */ }
        } })
      }
      void tick(element)
    }
  }
  const sync = () => { for (const element of watched.keys()) void tick(element) }
  const reveal = async (event: Event) => {
    const detail = (event as CustomEvent<{sessionId?:string; text?:string; source?:{address?:string;anchor?:TextAnchor}}>).detail
    const address = detail?.source?.address
    if (!address || !/^https?:\/\//i.test(address) || !detail.text) return
    const find = () => [...watched.keys()].find(element => readerSessionId(element) === detail.sessionId && readerSurfaceVisible(element) && (element.tagName.toLowerCase() === 'webview' ? (element as Webview).getURL?.() === address : (element as HTMLIFrameElement).src === address))
    let target = find()
    if (!target && open) { open(address); for (let i = 0; i < 40 && !target && !stopped; i++) { await new Promise(resolve => setTimeout(resolve, 100)); scan(); target = find() } }
    if (!target || stopped) return
    if (target.tagName.toLowerCase() === 'webview') await (target as Webview).executeJavaScript(`window.__paperMarginGuest?.reveal(${JSON.stringify(detail.text)},${JSON.stringify(detail.source?.anchor)})`, false)
    else ((target as HTMLIFrameElement).contentWindow as GuestWindow | null)?.__paperMarginGuest?.reveal(detail.text, detail.source?.anchor)
  }
  const onReveal = (event: Event) => { void reveal(event).catch(() => undefined) }
  const stopDiscovery = observeReaderRoots('webview[data-sidebar-browser-frame], iframe[data-sidebar-browser-frame], iframe[data-html-preview]', scan)
  document.addEventListener('dsh-sidenote:external-annotations-changed', sync)
  document.addEventListener('dsh-sidenote:reveal-external:v1', onReveal)
  const timer = setInterval(sync, 700); scan()
  return () => { stopped = true; clearInterval(timer); stopDiscovery(); document.removeEventListener('dsh-sidenote:external-annotations-changed', sync); document.removeEventListener('dsh-sidenote:reveal-external:v1', onReveal); for (const state of watched.values()) state.dispose(); watched.clear() }
}

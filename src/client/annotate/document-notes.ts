import { documentText, resolveTextAnchor, type TextAnchor } from './text-anchor'
import { readerSurfaceVisible, READER_VISIBILITY_ATTRIBUTES } from './reader-surface'
/** Reader projections never create a second store. Numbers belong to sidenote. */
export interface DocumentNote { id: number; number: number; anchorText: string; note: string; state: string; externalSource?: { address?: string; page?: number; anchor?: TextAnchor } }
const EVENT = 'dsh-sidenote:external-annotation:v1'
export function documentNotes(sessionId: string, address: string): DocumentNote[] {
  let items: DocumentNote[] = []
  document.dispatchEvent(new CustomEvent(EVENT, { detail: { action: 'list', sessionId, reply: (result: { items?: DocumentNote[] }) => { items = result.items ?? [] } } }))
  return items.filter(item => item.state === 'active' && item.externalSource?.address === address)
}
export function openDocumentNote(item: DocumentNote, sessionId: string, point: { x: number; y: number }): void {
  document.dispatchEvent(new CustomEvent(EVENT, { detail: { action: 'edit', sessionId, id: item.id, point, reply: () => undefined } }))
}
export const findDocumentQuote = resolveTextAnchor
export function revealDocumentQuote(root: Element, text: string, anchor?: TextAnchor): boolean {
  const range = resolveTextAnchor(root, text, anchor)
  if (!range) return false
  range.startContainer.parentElement?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
  document.dispatchEvent(new CustomEvent('dsh-paper-margin:document-focus', { detail: { root, range } }))
  return true
}
function clippedBounds(root: HTMLElement, content: Element = root): { left: number; top: number; right: number; bottom: number } {
  const rect = root.getBoundingClientRect()
  const bounds = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(window.innerWidth, rect.right), bottom: Math.min(window.innerHeight, rect.bottom) }
  for (let parent = content.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent); const box = parent.getBoundingClientRect()
    if (/auto|scroll|hidden|clip/.test(style.overflowY || style.overflow)) { bounds.top = Math.max(bounds.top, box.top); bounds.bottom = Math.min(bounds.bottom, box.bottom) }
    if (/auto|scroll|hidden|clip/.test(style.overflowX || style.overflow)) { bounds.left = Math.max(bounds.left, box.left); bounds.right = Math.min(bounds.right, box.right) }
  }
  return bounds
}
function badge(item: DocumentNote): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = String(item.number)
  button.title = `${item.anchorText}\n${item.note}`
  button.setAttribute('aria-label', `查看阅读批注 ${item.number}`)
  button.style.cssText = 'width:20px;height:20px;padding:0;flex:none;border:0;border-radius:50%;background:#2f88ff;color:#fff;font:600 11px sans-serif;box-shadow:0 1px 4px #0003;cursor:pointer;pointer-events:auto'
  return button
}
/** Sibling controls plus a clipped overlay preserve host text nodes and layout. */
export function attachDocumentNotes(): () => void {
  type Entry = { item: DocumentNote; range?: Range; button: HTMLButtonElement; marks: HTMLElement[] }
  type State = { bar: HTMLElement; layer: HTMLElement; signature: string; entries: Entry[]; dispose(): void }
  const mounted = new Map<HTMLElement, State>()
  let queued = false; let stopped = false; let frame = 0; let focusTimer: ReturnType<typeof setTimeout> | undefined
  let focusedText = ''
  const draw = () => {
    frame = 0
    // Measure every range before writing overlay styles; otherwise each note
    // forces a separate browser layout during scrolling.
    const plans: { state: State; visible: boolean; entries: { entry: Entry; rects: DOMRect[]; clip: ReturnType<typeof clippedBounds> }[] }[] = []
    for (const [root, state] of mounted) {
      const surfaceVisible = readerSurfaceVisible(root)
      const clips = new Map<Element, ReturnType<typeof clippedBounds>>()
      const entries = state.entries.filter(entry => entry.range).map(entry => {
        const parent = entry.range!.startContainer.parentElement ?? root
        let clip = clips.get(parent)
        if (!clip) { clip = clippedBounds(root, parent); clips.set(parent, clip) }
        const rects = surfaceVisible && typeof entry.range!.getClientRects === 'function' ? [...entry.range!.getClientRects()] : []
        return { entry, rects, clip }
      })
      plans.push({ state, visible: surfaceVisible, entries })
    }
    for (const { state, visible: surfaceVisible, entries } of plans) {
      state.bar.style.display = surfaceVisible ? 'flex' : 'none'
      state.layer.style.display = surfaceVisible ? '' : 'none'
      let previous = -24
      for (const { entry, clip, rects } of entries) {
        const visible = surfaceVisible && clip.right - clip.left > 24 && clip.bottom - clip.top > 20
        const rect = rects.find(r => r.bottom > clip.top && r.top < clip.bottom && r.right > clip.left && r.left < clip.right)
        entry.button.style.display = visible && rect ? 'block' : 'none'
        if (visible && rect) {
          const top = Math.max(clip.top, rect.top, previous + 23)
          entry.button.style.top = `${top}px`; entry.button.style.left = `${clip.right - 23}px`
          entry.button.style.display = top + 20 <= clip.bottom ? 'block' : 'none'; previous = top
        }
        let index = 0
        for (const box of visible ? rects : []) {
          const left = Math.max(box.left, clip.left); const top = Math.max(box.top, clip.top); const right = Math.min(box.right, clip.right); const bottom = Math.min(box.bottom, clip.bottom)
          if (right <= left || bottom <= top) continue
          let mark = entry.marks[index++]
          if (!mark) { mark = document.createElement('span'); state.layer.append(mark); entry.marks.push(mark) }
          mark.style.cssText = `position:fixed;pointer-events:none;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;background:rgba(47,136,255,${focusedText === (entry.item.externalSource?.anchor?.exact || entry.item.anchorText) ? '.3' : '.14'});border-bottom:1px solid #2f88ff66`
        }
        for (const mark of entry.marks.splice(index)) mark.remove()
      }
    }
  }
  const layout = () => { if (!stopped && !frame) frame = requestAnimationFrame(draw) }
  const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : undefined
  const scan = () => {
    queued = false; if (stopped) return
    for (const [root, state] of mounted) if (!root.isConnected) { state.dispose(); resize?.unobserve(root); mounted.delete(root) }
    for (const root of document.querySelectorAll<HTMLElement>('[data-textpreview-url]')) {
      if (root.querySelector('[data-paper-margin]')) { mounted.get(root)?.dispose(); mounted.delete(root); resize?.unobserve(root); continue }
      const address = root.getAttribute('data-textpreview-url')!
      const sessionId = root.closest('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session')
      if (!sessionId) continue
      const items = documentNotes(sessionId, address)
      let state = mounted.get(root)
      if (state && !items.length) { state.dispose(); mounted.delete(root); resize?.unobserve(root); continue }
      if (!state && items.length) {
        const bar = document.createElement('div'); bar.dataset.paperMarginDocumentNotes = ''; bar.setAttribute('aria-label', '本文已保存批注'); bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:5px 10px;flex:none;font:12px sans-serif;border-bottom:1px solid #8883'
        const layer = document.createElement('div'); layer.dataset.paperMarginDocumentOverlay = ''; layer.dataset.dshSidenote = ''; layer.style.cssText = 'position:fixed;inset:0;z-index:49;pointer-events:none'
        root.parentElement!.insertBefore(bar, root); document.body.append(layer)
        state = { bar, layer, entries: [], signature: '', dispose: () => { bar.remove(); layer.remove() } }; mounted.set(root, state); resize?.observe(root)
      }
      if (!state) continue
      // Build one text projection for all notes in this document, not one full
      // TreeWalker pass per note on every text mutation.
      const projection = documentText(root)
      const signature = JSON.stringify([sessionId, items, projection.text])
      if (signature === state.signature && state.entries.every(entry => !entry.range || entry.range.startContainer.isConnected && entry.range.toString() === (entry.item.externalSource?.anchor?.exact || entry.item.anchorText))) continue
      state.signature = signature; state.entries = []; state.bar.replaceChildren(); state.layer.replaceChildren()
      state.bar.style.display = items.length ? 'flex' : 'none'
      const label = document.createElement('span'); label.textContent = `本文批注 ${items.length}`; state.bar.append(label)
      for (const item of items) {
        const range = resolveTextAnchor(root, item.anchorText, item.externalSource?.anchor, projection)
        const button = badge(item)
        const entry: Entry = { item, range, button, marks: [] }; state.entries.push(entry)
        const reopen = (origin: HTMLElement) => {
          if (range) { range.startContainer.parentElement?.scrollIntoView?.({ block: 'center', inline: 'nearest' }); focusedText = range.toString(); layout() }
          const rect = origin.getBoundingClientRect(); openDocumentNote(item, sessionId, { x: rect.left - 300, y: rect.bottom })
        }
        button.addEventListener('click', () => reopen(button))
        const shortcut = badge(item); shortcut.addEventListener('click', () => reopen(shortcut)); state.bar.append(shortcut)
        if (range) { button.dataset.paperMarginDocumentBadge = String(item.id); button.style.position = 'fixed'; state.layer.append(button) }
        else { shortcut.title += '\n文件级引用；原文暂不可定位' }
      }
    }
    layout()
  }
  const schedule = () => { if (!queued && !stopped) { queued = true; queueMicrotask(scan) } }
  const observer = new MutationObserver(records => {
    const relevant = records.filter(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      if (target?.closest('[data-paper-margin],[data-paper-margin-document-notes],[data-paper-margin-document-overlay]')) return false
      if (record.type === 'attributes') return [...mounted.keys()].some(root => target?.contains(root)) || record.attributeName === 'data-textpreview-url'
      if (target?.closest('[data-textpreview-url]')) return true
      return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('[data-textpreview-url]') || node.querySelector('[data-textpreview-url]')))
    })
    if (relevant.some(record => record.type !== 'attributes' || record.attributeName === 'data-textpreview-url' || record.attributeName === 'data-sidebar-right-session')) schedule()
    if (relevant.length && mounted.size) layout()
  })
  observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-textpreview-url', ...READER_VISIBILITY_ATTRIBUTES] })
  const focus = (event: Event) => { focusedText = (event as CustomEvent<{ range: Range }>).detail.range.toString(); clearTimeout(focusTimer); focusTimer = setTimeout(() => { focusedText = ''; layout() }, 1800); layout() }
  document.addEventListener('dsh-paper-margin:document-focus', focus)
  document.addEventListener('dsh-sidenote:external-annotations-changed', schedule); window.addEventListener('scroll', layout, true); window.addEventListener('resize', layout); scan()
  return () => { stopped = true; observer.disconnect(); resize?.disconnect(); cancelAnimationFrame(frame); clearTimeout(focusTimer); document.removeEventListener('dsh-paper-margin:document-focus', focus); document.removeEventListener('dsh-sidenote:external-annotations-changed', schedule); window.removeEventListener('scroll', layout, true); window.removeEventListener('resize', layout); for (const state of mounted.values()) state.dispose(); mounted.clear() }
}

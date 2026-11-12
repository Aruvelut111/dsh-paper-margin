import { openInlineEditor } from './editor'
import { sourceInfo, type CapturedSelection, type UniversalAnnotatorOptions } from './universal'
import { readerSessionId, readerSurfaceVisible } from './reader-surface'

/** Use FortuneSheet's native copy projection; never inspect React internals or read the system clipboard. */
export function selectedExcelText(root: HTMLElement): string | undefined {
  const grid = root.querySelector<HTMLElement>('.fortune-container')
  if (!grid) return undefined
  let text: string | undefined
  let nativeClipboard: string | null | undefined
  try { nativeClipboard = sessionStorage.getItem('localClipboard') } catch { /* optional native cache */ }
  const capture = (event: Event) => {
    const buffer = root.querySelector<HTMLElement>('#fortune-copy-content')
    if (buffer) text = [...buffer.querySelectorAll('tr')].map(row => [...row.querySelectorAll('td,th')].map(cell => cell.textContent ?? '').join('\t')).join('\n')
    // The user requested annotation, so the native copy must not replace their clipboard.
    event.preventDefault(); event.stopImmediatePropagation()
  }
  document.addEventListener('copy', capture, true)
  try {
    root.querySelector('#fortune-copy-content')?.remove()
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, bubbles: true, cancelable: true }))
  } finally {
    document.removeEventListener('copy', capture, true)
    try { if (nativeClipboard === null) sessionStorage.removeItem('localClipboard'); else if (nativeClipboard !== undefined) sessionStorage.setItem('localClipboard', nativeClipboard) } catch { /* optional native cache */ }
  }
  root.querySelector('#fortune-copy-content')?.remove()
  return text
}

export function attachExcelAnnotations(onAnnotate: UniversalAnnotatorOptions['onAnnotate']): () => void {
  const roots = new Map<HTMLElement, { bar: HTMLElement; dispose(): void }>()
  let stopped = false
  const scan = () => {
    if (stopped) return
    for (const [root, state] of roots) if (!root.isConnected) { state.dispose(); roots.delete(root) }
    for (const root of document.querySelectorAll<HTMLElement>('[data-excel-preview]')) {
      if (roots.has(root)) continue
      const bar = document.createElement('div'); bar.dataset.paperMarginExcel = ''; bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;font:12px sans-serif;flex:none'
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '添加到对话'; button.title = '添加所选单元格与评论'; button.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:5px;padding:4px 8px;cursor:pointer'
      const status = document.createElement('span'); status.setAttribute('role', 'status')
      bar.append(button, status); root.parentElement!.insertBefore(bar, root)
      let close: (() => void) | undefined; let timer: ReturnType<typeof setTimeout> | undefined
      button.addEventListener('mousedown', event => event.preventDefault())
      button.addEventListener('click', () => {
        if (!readerSurfaceVisible(root)) return
        const range = root.querySelector('.fortune-name-box')?.textContent?.trim()
        const quote = selectedExcelText(root)
        if (quote === undefined) { status.textContent = '请先在表格中选择单元格；当前查看器未返回所选内容'; return }
        const sheet = root.querySelector('.luckysheet-sheets-item-active')?.textContent?.trim()
        const rect = button.getBoundingClientRect()
        const captured: CapturedSelection = { ...sourceInfo(root), kind: 'excel', quote: quote || '（空白单元格）', where: [sheet, range].filter(Boolean).join(' · ') || '表格选区', sessionId: root.closest('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session') ?? undefined, point: { x: rect.left, y: rect.bottom } }
        // FortuneSheet restores focus after copy; open the editor after that restoration.
        clearTimeout(timer); timer = setTimeout(() => {
          if (!readerSurfaceVisible(root) || readerSessionId(root) !== captured.sessionId) return
          const handle = onAnnotate(captured)
          if (typeof handle === 'object') close = openInlineEditor({ quote: captured.quote, x: rect.left, y: rect.bottom, save: handle.update, draft: handle.update })
        }, 25)
      })
      roots.set(root, { bar, dispose: () => { clearTimeout(timer); close?.(); bar.remove() } })
    }
  }
  const observer = new MutationObserver(scan); observer.observe(document.body, { childList: true, subtree: true }); scan()
  return () => { stopped = true; observer.disconnect(); for (const state of roots.values()) state.dispose(); roots.clear() }
}

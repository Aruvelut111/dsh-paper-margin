import { openInlineEditor } from './editor'
import { sourceInfo, type UniversalAnnotatorOptions } from './universal'
import { readerSurfaceVisible } from './reader-surface'

/** An explicit action leaves native pan, zoom, drag and context menus intact. */
export function attachImageAnnotations(onAnnotate: UniversalAnnotatorOptions['onAnnotate']): () => void {
  const mounted = new Map<HTMLElement, () => void>()
  const scan = () => {
    for (const [root, dispose] of mounted) if (!root.isConnected) { dispose(); mounted.delete(root) }
    for (const root of document.querySelectorAll<HTMLElement>('[data-image-preview]')) {
      if (mounted.has(root)) continue
      const bar = document.createElement('div'); bar.dataset.paperMarginImage = ''; bar.style.cssText = 'position:relative;z-index:2;padding:6px;font:12px sans-serif'
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '添加到对话'; button.title = '添加整图评论与原文件地址'; button.style.cssText = 'font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid #8886;border-radius:5px;padding:4px 8px;cursor:pointer'
      bar.append(button); root.parentElement!.insertBefore(bar, root)
      let close: (() => void) | undefined
      button.addEventListener('click', event => {
        if (!readerSurfaceVisible(root)) return
        event.stopPropagation(); const image = root.querySelector('img'); if (!image) return
        const rect = button.getBoundingClientRect()
        const capture = { ...sourceInfo(image), kind: 'image', quote: image.alt || '图片（整图）', where: '整图', sessionId: root.closest('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session') ?? undefined, point: { x: rect.left, y: rect.bottom } }
        const handle = onAnnotate(capture)
        if (typeof handle === 'object') close = openInlineEditor({ quote: capture.quote, x: rect.left, y: rect.bottom, draft: handle.update, save: handle.update })
      })
      mounted.set(root, () => { close?.(); bar.remove() })
    }
  }
  const observer = new MutationObserver(scan); observer.observe(document.body, { childList: true, subtree: true }); scan()
  return () => { observer.disconnect(); for (const dispose of mounted.values()) dispose(); mounted.clear() }
}

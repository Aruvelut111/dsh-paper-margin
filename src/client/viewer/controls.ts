import { el } from '../annotate/dom'
export interface ReaderControlView {
  numPages: number; scroller: HTMLElement
  currentPage(): number
  reveal(page: number): void
  zoom(factor: number): void
  locate(quote: string, page?: number): Promise<{ page: number; boxes: readonly { x: number; y: number; w: number; h: number }[] } | null>
  flash(page: number, boxes: readonly { x: number; y: number; w: number; h: number }[]): void
}
export function readerControls(view: ReaderControlView): { node: HTMLElement; refresh(): void; dispose(): void } {
  const previous = el('button', { type: 'button', 'aria-label': '上一页', onClick: () => view.reveal(Math.max(1, view.currentPage() - 1)) }, '‹')
  const next = el('button', { type: 'button', 'aria-label': '下一页', onClick: () => view.reveal(Math.min(view.numPages, view.currentPage() + 1)) }, '›')
  const page = el('input', { type: 'number', min: 1, value: '1', 'aria-label': 'PDF 页码', style: { width: '55px' } })
  const count = el('span')
  const go = () => { const n = Number(page.value); if (Number.isInteger(n) && n >= 1 && n <= view.numPages) view.reveal(n) }
  page.addEventListener('change', go); page.addEventListener('keydown', event => { if (event.key === 'Enter') go() })
  const zoom = el('select', { 'aria-label': 'PDF 缩放' }, ...[[1, '适合宽度'], [1.25, '125%'], [1.5, '150%'], [2, '200%']].map(([value, label]) => el('option', { value }, String(label))))
  zoom.addEventListener('change', () => view.zoom(Number(zoom.value)))
  const query = el('input', { type: 'search', placeholder: '查找原文', 'aria-label': '查找 PDF 原文', style: { width: '100px', minWidth: '65px', flex: '1' } })
  const status = el('span', { role: 'status', style: { fontSize: '11px' } })
  let disposed = false; let searching = false
  const search = async () => {
    if (searching || !query.value.trim()) return
    searching = true; status.textContent = '查找中…'
    try {
      const found = await view.locate(query.value, view.currentPage())
      if (disposed) return
      if (found) { view.reveal(found.page); view.flash(found.page, found.boxes); status.textContent = `第 ${found.page} 页` }
      else status.textContent = '当前页附近未找到（最多查 32 页）'
    } catch { if (!disposed) status.textContent = '查找失败，请重试' }
    finally { searching = false }
  }
  query.addEventListener('keydown', event => { if (event.key === 'Enter') void search() })
  const find = el('button', { type: 'button', onClick: () => { void search() } }, '查找')
  const node = el('nav', { 'aria-label': 'PDF 阅读工具', 'data-paper-margin-reader-controls': '', style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px', padding: '6px 10px', borderBottom: '1px solid #8883', fontSize: '12px' } }, previous, page, count, next, zoom, query, find, status)
  for (const field of node.querySelectorAll<HTMLElement>('button, input, select')) Object.assign(field.style, { color: 'inherit', background: 'var(--dsw-alias-bg-layer-2, transparent)', border: '1px solid var(--dsw-alias-border-l2, #8886)', borderRadius: '5px', padding: '4px 6px', font: 'inherit' })
  let lastPage = -1; let lastCount = -1
  return { node, refresh() {
    const current = view.currentPage()
    if (current === lastPage && view.numPages === lastCount) return
    lastPage = current; lastCount = view.numPages
    if (document.activeElement !== page) page.value = String(current)
    page.max = String(view.numPages); count.textContent = `/ ${view.numPages}`
    previous.disabled = current <= 1; next.disabled = current >= view.numPages
  }, dispose() { disposed = true; node.remove() } }
}

import { el } from './dom'

interface InlineEditorOptions {
  quote: string
  x: number
  y: number
  initial?: string
  save(note: string): void
  draft?(note: string): void
  closed?(): void
}
let active: (() => void) | undefined
/** Edit next to the selected passage. Enter confirms, Shift+Enter adds a line. */
export function openInlineEditor(options: InlineEditorOptions): () => void {
  active?.()
  const quote = el('blockquote', { style: { margin: '0 0 8px', borderLeft: '2px solid #809bd2', paddingLeft: '8px', maxHeight: '64px', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', opacity: '.8' } }, options.quote)
  const input = el('textarea', { 'aria-label': '就地批注', placeholder: '写批注… Enter 确认，Shift+Enter 换行', rows: 2, style: { width: '100%', minHeight: '54px', maxHeight: '180px', boxSizing: 'border-box', resize: 'vertical', color: 'inherit', background: 'transparent', border: '1px solid #8886', borderRadius: '5px', padding: '7px', font: 'inherit' } })
  input.value = options.initial ?? ''
  const status = el('span', { role: 'status', style: { fontSize: '11px' } })
  const save = el('button', { type: 'button', 'aria-label': '确认批注' }, '✓ 确认')
  const close = el('button', { type: 'button', 'aria-label': '收起就地批注' }, '收起')
  const root = el('section', { role: 'dialog', 'aria-label': '就地写批注', 'data-paper-margin-editor': '', style: { position: 'fixed', width: 'min(340px, calc(100vw - 24px))', zIndex: '2147483100', padding: '10px', boxSizing: 'border-box', borderRadius: '9px', border: '1px solid var(--dsw-alias-border-l2, #8887)', background: 'var(--dsw-alias-bg-layer-3, #fff)', color: 'var(--dsw-alias-label-primary, #222)', boxShadow: '0 6px 24px #0003', font: '13px var(--dsw-font-family, sans-serif)' } }, quote, input, el('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '6px', marginTop: '7px' } }, status, close, save))
  for (const button of [save, close]) Object.assign(button.style, { color: 'inherit', background: 'transparent', border: '1px solid #8886', borderRadius: '5px', padding: '4px 9px', cursor: 'pointer', font: 'inherit' })
  document.body.append(root)
  root.style.left = `${Math.max(8, Math.min(options.x, innerWidth - root.offsetWidth - 8))}px`
  root.style.top = `${Math.max(8, Math.min(options.y + 6, innerHeight - root.offsetHeight - 8))}px`
  let disposed = false; let composing = false; let lastValue = input.value
  const dispose = () => {
    if (disposed) return; disposed = true; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', key, true); root.remove(); if (active === commit) active = undefined; options.closed?.()
  }
  const commit = () => {
    if (disposed) return
    try { options.save(input.value); dispose() } catch (error) { status.textContent = `未保存：${String(error)}` }
  }
  const outside = (event: MouseEvent) => { if (event.target instanceof Node && !root.contains(event.target)) commit() }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); commit() }
  }
  input.addEventListener('compositionstart', () => { composing = true })
  input.addEventListener('compositionend', () => { composing = false; options.draft?.(input.value) })
  input.addEventListener('input', () => { lastValue = input.value; if (!composing) options.draft?.(lastValue) })
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !composing) { event.preventDefault(); event.stopPropagation(); commit() }
  })
  save.addEventListener('click', commit); close.addEventListener('click', commit)
  document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', key, true)
  active = commit; input.focus()
  return commit
}

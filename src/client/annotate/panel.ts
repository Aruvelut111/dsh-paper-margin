import { buildProtocolBlock, type Annotation } from '../../contract'
import { el } from './dom'
import type { AnnotationStore } from './store'

export interface PanelActions {
  onSendDraft(annotations: readonly Annotation[], block: string): Promise<boolean>
  onSendDirect(annotations: readonly Annotation[], block: string): Promise<boolean>
  onReveal?(annotation: Annotation): void
  include?(annotation: Annotation): boolean
  showDirect?(): boolean
}

/** Keep keyed native nodes alive while editing, including Chinese IME composition. */
export function renderAnnotationPanel(container: HTMLElement, store: AnnotationStore, address: string | (() => readonly string[]), file: string, actions: PanelActions): () => void {
  const addresses = (): readonly string[] => typeof address === 'string' ? [address] : address()
  const entries = () => addresses().flatMap(key => store.list(key).filter(a => actions.include?.(a) !== false).map(annotation => ({ key, annotation })))
  const count = el('span')
  const status = el('p', { role: 'status', style: { margin: '6px 0', fontSize: '12px' } })
  const list = el('div', { 'data-paper-margin-notes': '' })
  const empty = el('p', {}, '划选原文后点「添加到对话」，就地输入；多条评论可一起发送。图片使用预览中的「添加到对话」。')
  const draft = el('button', { type: 'button', 'data-paper-margin-draft': '' }, '加入输入框')
  const direct = el('button', { type: 'button' }, '直接发送')
  const clear = el('button', { type: 'button' }, '清除已带回')
  const copy = el('button', { type: 'button' }, '复制批注')
  const rows = new Map<string, { node: HTMLElement; input: HTMLTextAreaElement; meta: HTMLElement; quote: HTMLElement }>()
  let busy = false
  let disposed = false
  const buttons = [draft, direct, copy, clear]
  for (const button of buttons) Object.assign(button.style, buttonStyle)
  const run = async (send: PanelActions['onSendDraft']): Promise<void> => {
    if (busy) return
    const batch = entries().filter(({ annotation }) => annotation.state === 'active')
    if (batch.length === 0) return
    busy = true; render()
    try {
      const notes = batch.map(item => item.annotation)
      const ok = await send(notes, buildProtocolBlock(notes))
      if (ok) for (const key of new Set(batch.map(item => item.key))) {
        // Edits made while admission is pending remain active for the next batch.
        store.markSent(key, batch.filter(item => item.key === key && store.list(key).find(a => a.id === item.annotation.id)?.note === item.annotation.note).map(item => item.annotation.id))
      }
      if (!disposed) status.textContent = ok ? `已带回 ${batch.length} 条批注` : '输入框暂不可用，批注已保留，可复制后粘贴。'
    } catch (error) { if (!disposed) status.textContent = `操作失败，批注已保留：${String(error)}` }
    finally { busy = false; if (!disposed) render() }
  }
  draft.addEventListener('click', () => { void run(actions.onSendDraft) })
  direct.addEventListener('click', () => { void run(actions.onSendDirect) })
  clear.addEventListener('click', () => { for (const { key, annotation } of entries()) if (annotation.state === 'sent') store.remove(key, annotation.id) })
  copy.addEventListener('click', () => {
    const text = buildProtocolBlock(entries().filter(item => item.annotation.state === 'active').map(item => item.annotation))
    if (!navigator.clipboard) { status.textContent = '剪贴板不可用，请使用「加入输入框」。'; return }
    void navigator.clipboard.writeText(text).then(() => { status.textContent = '批注已复制' }, () => { status.textContent = '剪贴板不可用，请使用「加入输入框」。' })
  })
  container.replaceChildren(el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontWeight: '600' } }, `批注 · ${file}`, count), empty, list, el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } }, ...buttons), status)
  container.setAttribute('data-paper-margin-panel', '')
  Object.assign(container.style, panelStyle)
  function render(): void {
    direct.hidden = actions.showDirect?.() === false
    const all = entries()
    const alive = new Set<string>()
    const active = all.filter(item => item.annotation.state === 'active').length
    count.textContent = `${active} 待处理 / ${all.length}`
    empty.hidden = all.length > 0
    draft.disabled = direct.disabled = copy.disabled = busy || active === 0
    clear.disabled = busy || active === all.length
    for (const { key, annotation: a } of all) {
      const identity = `${key}:${a.id}`
      alive.add(identity)
      let row = rows.get(identity)
      if (row === undefined) {
        const input = el('textarea', { 'aria-label': '批注备注', placeholder: '写下你的问题或注解…', rows: 2, style: { width: '100%', boxSizing: 'border-box', minHeight: '58px', resize: 'vertical', font: 'inherit', padding: '7px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #8886)', color: 'inherit', background: 'var(--dsw-alias-bg-layer-2, transparent)' } })
        input.value = a.note
        input.addEventListener('input', () => store.update(key, a.id, input.value))
        const meta = el('button', { type: 'button', style: { ...buttonStyle, textAlign: 'left', padding: '0', border: 'none' } })
        meta.addEventListener('click', () => { const latest = store.list(key).find(item => item.id === a.id); if (latest) actions.onReveal?.(latest) })
        const quote = el('blockquote', { style: { margin: '4px 0', padding: '4px 8px', borderLeft: '2px solid #8b9bba', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '100px', overflow: 'auto' } })
        const remove = el('button', { type: 'button', style: buttonStyle, onClick: () => store.remove(key, a.id) }, '移除')
        const node = el('article', { 'data-paper-margin-note': a.id, style: { padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l1, #8883)' } }, meta, quote, input, remove)
        row = { node, input, meta, quote }; rows.set(identity, row); list.append(node)
      }
      row.meta.textContent = `${a.file}${a.anchor.where ? ` · ${a.anchor.where}` : a.anchor.page > 0 ? ` · p.${a.anchor.page}` : ''}${a.state === 'sent' ? ' · 已带回' : ''}`
      row.quote.textContent = a.anchor.quote
      if (document.activeElement !== row.input && row.input.value !== a.note) row.input.value = a.note
    }
    for (const [id, row] of rows) if (!alive.has(id)) { row.node.remove(); rows.delete(id) }
    const error = store.persistenceError?.()
    if (error) status.textContent = error
  }
  const unsubscribe = store.subscribe(render)
  render()
  return () => { disposed = true; unsubscribe(); container.replaceChildren() }
}

const buttonStyle = { border: '1px solid var(--dsw-alias-border-l2, #8886)', borderRadius: '6px', padding: '5px 9px', cursor: 'pointer', font: 'inherit', fontSize: '12px', color: 'inherit', background: 'var(--dsw-alias-bg-layer-2, transparent)' }
export const panelStyle = { padding: '12px', fontFamily: 'var(--dsw-font, sans-serif)', fontSize: '13px', color: 'var(--dsw-alias-label-primary, inherit)', overflow: 'auto' }

import { el } from './dom'
import { renderAnnotationPanel } from './panel'
import type { AnnotationStore } from './store'
import { currentSessionId, sendToDraft, sendDirect } from '../protocol/composer'
import type { Annotation } from '../../contract'
import { exportNotes, importNotes, saveNotesFile } from './backup'
import { sidenoteAvailable } from './sidenote'
import { getSharedPreferences } from '../index'

export function installNotebook(ctx: Parameters<typeof currentSessionId>[0], store: AnnotationStore, reveal: (annotation: Annotation) => void) {
  const dock = el('button', { type: 'button', 'data-paper-margin-notebook-toggle': '', 'aria-label': '打开阅读批注', style: { position: 'fixed', right: '14px', bottom: '110px', zIndex: '1000', padding: '7px 12px', borderRadius: '18px', border: '1px solid var(--dsw-alias-border-l2, #8886)', color: 'var(--dsw-alias-label-primary, #eee)', background: 'var(--dsw-alias-bg-layer-3, #25272d)', cursor: 'pointer', font: '13px sans-serif' } }, '阅读批注')
  const body = el('div', { style: { minHeight: '0', overflow: 'auto', flex: '1' } })
  const close = el('button', { type: 'button', onClick: () => { panel.hidden = true }, 'aria-label': '收起阅读批注' }, '收起')
  const panel = el('section', { hidden: true, role: 'region', 'aria-label': '阅读批注篮', 'data-paper-margin-notebook': '', style: { position: 'fixed', right: '12px', bottom: '148px', width: 'min(390px, calc(100vw - 24px))', maxHeight: 'min(650px, calc(100vh - 180px))', zIndex: '1001', borderRadius: '10px', boxShadow: '0 8px 36px #0004', border: '1px solid var(--dsw-alias-border-l2, #8886)', color: 'var(--dsw-alias-label-primary, #eee)', background: 'var(--dsw-alias-bg-layer-3, #25272d)', overflow: 'auto' } }, el('header', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #8884' } }, '阅读批注', close), body)
  document.body.append(dock, panel)
  const backupStatus = el('p', { role: 'status' })
  let showAll = false
  let viewSession: string | undefined
  let dockCount = 0
  const targetSession = () => viewSession || currentSessionId(ctx)
  const scope = el('select', { 'aria-label': '批注范围' }, el('option', { value: 'current' }, '当前会话'), el('option', { value: 'all' }, '全部已保存批注'))
  scope.addEventListener('change', () => { showAll = scope.value === 'all'; stopPanel(); stopPanel = mount(); refresh() })
  panel.querySelector('header')!.append(scope)
  const exportButton = el('button', { type: 'button', onClick: () => saveNotesFile(exportNotes(store)) }, '备份全部批注')
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': '选择批注备份' })
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]; if (!file) return
    if (file.size > 20 * 1024 * 1024) { backupStatus.textContent = '备份文件超过 20 MB'; return }
    void file.text().then(raw => { backupStatus.textContent = `已导入 ${importNotes(store, raw)} 条批注（保留原有内容）` }).catch(error => { backupStatus.textContent = `导入失败：${String(error)}` }).finally(() => { fileInput.value = '' })
  })
  const restoreButton = el('button', { type: 'button', onClick: () => fileInput.click() }, '导入备份')
  panel.append(el('footer', { style: { padding: '8px 12px', borderTop: '1px solid #8884' } }, exportButton, restoreButton, fileInput, backupStatus))
  const keys = () => {
    const id = targetSession()
    return store.addresses().filter(key => store.list(key).some(note => showAll || !note.sessionId || note.sessionId === id))
  }
  const mount = () => renderAnnotationPanel(body, store, keys, '当前会话', {
    include: a => showAll || !a.sessionId || a.sessionId === targetSession(),
    onSendDraft: async (_notes, block) => sendToDraft(ctx, targetSession(), block).ok,
    onSendDirect: async (_notes, block) => sendDirect(ctx, targetSession(), block),
    onReveal: reveal,
    showDirect: () => getSharedPreferences()?.getSnapshot().directSubmit === true,
  })
  let stopPanel = mount()
  const offPreferences = getSharedPreferences()?.subscribe(() => { stopPanel(); stopPanel = mount() })
  const refresh = () => {
    const count = keys().flatMap(key => store.list(key)).filter(a => a.state === 'active' && (showAll || !a.sessionId || a.sessionId === targetSession())).length
    dock.hidden = dockCount > 0 || sidenoteAvailable() && keys().length === 0
    dock.textContent = `阅读批注${count ? ` · ${count}` : ''}`
    dock.setAttribute('aria-expanded', String(!panel.hidden))
  }
  const open = (id?: string, sessionId?: string) => {
    if (viewSession !== sessionId) { viewSession = sessionId; stopPanel(); stopPanel = mount() }
    panel.hidden = false; refresh()
    if (id) { const input = [...body.querySelectorAll<HTMLElement>('[data-paper-margin-note]')].find(row => row.dataset.paperMarginNote === id)?.querySelector('textarea'); input?.focus() }
  }
  dock.addEventListener('click', () => { panel.hidden = !panel.hidden; refresh() })
  const unsubscribe = store.subscribe(refresh)
  const sessionList = ctx.sessions?.list as unknown as { subscribe?(fn: () => void): () => void } | undefined
  const offSession = sessionList?.subscribe?.(() => { stopPanel(); stopPanel = mount(); refresh() })
  let selectedSession = currentSessionId(ctx)
  const sessionObserver = new MutationObserver(() => {
    const next = currentSessionId(ctx)
    if (next !== selectedSession) { selectedSession = next; viewSession = undefined; stopPanel(); stopPanel = mount(); refresh() }
  })
  sessionObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-conversation-session'] })
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') panel.hidden = true }
  document.addEventListener('keydown', onKey)
  refresh()
  const bridgeChanged = () => refresh()
  document.addEventListener('dsh-sidenote:external-annotations-changed', bridgeChanged)
  return { open, dockMounted(value: boolean) { dockCount = Math.max(0, dockCount + (value ? 1 : -1)); refresh() }, dispose() { unsubscribe(); offPreferences?.(); offSession?.(); sessionObserver.disconnect(); stopPanel(); document.removeEventListener('keydown', onKey); document.removeEventListener('dsh-sidenote:external-annotations-changed', bridgeChanged); dock.remove(); panel.remove() } }
}

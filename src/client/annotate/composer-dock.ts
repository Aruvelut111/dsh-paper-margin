import { h } from '../h'
import { buildProtocolBlock } from '../../contract'
import { sendToDraft, type currentSessionId } from '../protocol/composer'
import { sidenoteAvailable } from './sidenote'
import type { AnnotationStore } from './store'

/** Standalone fallback. Integrated sidenote owns the normal composer chip. */
export function registerAnnotationDock(ctx: Parameters<typeof currentSessionId>[0] & {
  slots: { inject(name: string, factory: () => unknown): unknown; register(definition: Record<string, unknown>, component: unknown): unknown }
}, store: AnnotationStore, notebook: { open(id?: string, sessionId?: string): void; dockMounted(value: boolean): void }): unknown {
  return ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-paper-margin-annotations', order: 12, registrant: 'dsh-paper-margin' }, function AnnotationDock(props: { session: { sessionId: string } }) {
    const React = require('react') as { useSyncExternalStore(subscribe: AnnotationStore['subscribe'], snapshot: AnnotationStore['getSnapshot']): number; useState<T>(initial: T): [T, (value: T) => void]; useEffect(fn: () => (() => void), deps: unknown[]): void }
    React.useSyncExternalStore(store.subscribe, store.getSnapshot)
    const [status, setStatus] = React.useState('')
    const [integrated, setIntegrated] = React.useState(sidenoteAvailable())
    // Plugin activation order varies. Retire the empty fallback when sidenote
    // becomes ready, while keeping genuinely saved legacy notes accessible.
    React.useEffect(() => {
      const refresh = () => setIntegrated(sidenoteAvailable())
      document.addEventListener('dsh-sidenote:external-annotations-changed', refresh); refresh()
      return () => document.removeEventListener('dsh-sidenote:external-annotations-changed', refresh)
    }, [])
    React.useEffect(() => { notebook.dockMounted(true); return () => notebook.dockMounted(false) }, [])
    const sessionId = props.session.sessionId
    const all = store.addresses().flatMap(key => store.list(key).filter(a => !a.sessionId || a.sessionId === sessionId).map(annotation => ({ key, annotation })))
    const entries = all.filter(item => item.annotation.state === 'active')
    if (all.length === 0 && integrated) return null
    const add = () => {
      const result = sendToDraft(ctx, sessionId, buildProtocolBlock(entries.map(item => item.annotation)))
      if (result.ok) {
        for (const key of new Set(entries.map(item => item.key))) store.markSent(key, entries.filter(item => item.key === key).map(item => item.annotation.id))
        setStatus('已加入输入框，可和你的问题一起发送')
      } else setStatus(result.reason || '加入失败，批注已保留')
    }
    const style = { font: 'inherit', fontSize: 12, padding: '4px 9px', borderRadius: 8, border: '1px solid #8885', background: 'transparent', color: 'inherit', cursor: 'pointer' }
    return h('div', { 'data-paper-margin-composer-dock': '', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
      h('button', { type: 'button', style, onClick: () => notebook.open(undefined, sessionId), 'aria-label': '查看阅读批注' }, '✎ 阅读批注' + (entries.length ? ' · ' + entries.length : '')),
      entries.length ? h('button', { type: 'button', style, onClick: add }, '将 ' + entries.length + ' 条批注加入输入框') : null,
      status ? h('span', { role: 'status', style: { fontSize: 12 } }, status) : null)
  }))
}

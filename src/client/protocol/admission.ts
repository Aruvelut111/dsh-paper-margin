/** Confirm native submission against durable chat/inbox rows, never draft echo. */
interface Observable<T> { getSnapshot(): T; subscribe(fn: () => void): () => void }
interface Message { seq?: number; id?: string; messageId?: string; kind?: string; content?: unknown }
interface SessionState { nodes?: Message[]; queue?: Message[]; promptError?: unknown; removed?: boolean; openState?: string }
interface Inbox { 'next-turn'?: Message[]; 'next-step'?: Message[] }
interface Binding { session: Observable<SessionState> & { projections?: { faceOf(name: string): Observable<Inbox | undefined> } } }
export interface AdmissionContext {
  sessions?: { binding?(id: string): unknown }
  get?(name: string): unknown
}
export function observeAdmission(ctx: AdmissionContext, sessionId: string, needle: string): { start(submit: () => void): Promise<boolean> } | undefined {
  try {
    const binding = ctx.sessions?.binding?.(sessionId) as Binding | undefined
    if (!binding?.session?.getSnapshot || !binding.session.subscribe) return undefined
    const session = binding.session
    const ui = ctx.get?.('uiConversation') as { binding?(b: Binding): { target?(name: string): Observable<{ legacy?: { nodes?: Message[] } }> } } | undefined
    const chat = ui?.binding?.(binding)?.target?.('chat')
    const nodes = () => chat ? chat.getSnapshot()?.legacy?.nodes : session.getSnapshot().nodes
    if (!Array.isArray(nodes())) return undefined
    const inbox = session.projections?.faceOf('inbox')
    const queued = () => session.getSnapshot().queue ?? [...(inbox?.getSnapshot()?.['next-turn'] ?? []), ...(inbox?.getSnapshot()?.['next-step'] ?? [])]
    const baseline = new Set(nodes()!.map(m => m.messageId ?? m.id ?? m.seq))
    const maxSeq = Math.max(-1, ...nodes()!.map(m => m.seq ?? -1))
    const beforeQueue = queued()
    const queueIds = new Set(beforeQueue.map(m => m.messageId ?? m.id))
    const errorBefore = session.getSnapshot().promptError
    const matches = (m: Message) => {
      const parts = Array.isArray(m.content) ? m.content : []
      const text = parts.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n')
      return text.trimStart().startsWith(needle.trimStart())
    }
    return { start(submit) {
      return new Promise<boolean>(resolve => {
        let done = false
        let submitted = false
        const off: (() => void)[] = []
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (ok: boolean) => { if (done) return; done = true; if (timer) clearTimeout(timer); off.splice(0).forEach(f => f()); resolve(ok) }
        const check = () => {
          if (!submitted || done) return
          if (nodes()?.some(m => (m.kind === 'user' || m.kind === 'steering')
            && !baseline.has(m.messageId ?? m.id ?? m.seq) && (m.seq ?? -1) > maxSeq && matches(m)
            && (m.messageId || m.id ? !queueIds.has(m.messageId ?? m.id) : !beforeQueue.some(matches)))
            || queued().some(m => (m.messageId ?? m.id) !== undefined && !queueIds.has(m.messageId ?? m.id) && matches(m))) { finish(true); return }
          const state = session.getSnapshot()
          if ((state.promptError && state.promptError !== errorBefore) || state.removed || state.openState === 'error') finish(false)
        }
        off.push(session.subscribe(check))
        if (chat) off.push(chat.subscribe(check))
        if (inbox) off.push(inbox.subscribe(check))
        submitted = true; timer = setTimeout(() => finish(false), 15000)
        try { submit(); check() } catch { finish(false) }
      })
    } }
  } catch { return undefined }
}

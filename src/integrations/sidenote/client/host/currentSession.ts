import type { Context } from './contracts.ts'

/**
 * 当前（在屏）会话 id 的双版本探测：0.1.5 的 SessionListState 带 `current`
 * 字段；0.1.7 移除了它（列表只剩 ids/byId/phase），改为会话视图 DOM 的
 * `[data-conversation-session]` 属性携带。两源皆空 → ''（调用方按既有
 * 降级语义处理：守卫拒绝、工具条不弹、按钮不渲染）。
 */
export function currentSessionIdOf(ctx: Context): string {
  try {
    const current = (ctx.sessions.list.getSnapshot() as { current?: unknown }).current
    if (typeof current === 'string' && current !== '') return current
  } catch {
    // 落 DOM 源。
  }
  if (typeof document === 'undefined') return ''
  return document.querySelector<HTMLElement>('[data-conversation-session]')?.dataset.conversationSession ?? ''
}

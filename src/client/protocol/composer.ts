/**
 * Composer handoff: the sidenote-compatible path from annotations to the chat.
 *
 * Default verb writes the protocol block into the input draft (never sends) —
 * the file-annotate discipline. Direct submit uses the same native admission
 * prepared via the conversation input facade, mirroring sidenote's
 * prepareSubmission shape but at draft-size scope: the block goes in as a
 * prefix, submit() is called, and rejection keeps the draft available for retry.
 *
 * Everything reads host shapes through structural probes; nothing imports the
 * host's internals.
 */
import type { Annotation } from '../../contract'
import { observeAdmission } from './admission'

/** Structural faces of the conversation input facade (sidenote contracts). */
interface InputStateLike {
  getSnapshot(): {
    draft?: unknown
    phase?: string
    draftRev?: number
    occurrences?: unknown[]
    /** Set when the host rejected the last submission. */
    promptError?: unknown
  }
  subscribe(fn: () => void): () => void
}

interface SessionInputLike {
  state: InputStateLike
  setDraft(text: string): void
  submit?: (mode?: 'queue' | 'steer') => void
  insertText?: (text: string, range: { start: number; end: number; draftRev: number }) => boolean
}

interface ClientContextLike {
  sessions?: {
    list?: { getSnapshot?(): { current?: string } }
    scope?(id: string): unknown
    binding?(id: string): unknown
  }
  get?(name: string): unknown
}

/** The current chat's session id, or empty when none is open. */
export function currentSessionId(ctx: ClientContextLike): string {
  try {
    const current = ctx.sessions?.list?.getSnapshot?.().current
    if (typeof current === 'string' && current !== '') return current
  } catch {
    // Fall through to the host's visible conversation identity.
  }
  return typeof document === 'undefined' ? '' : document.querySelector<HTMLElement>('[data-conversation-session]')?.dataset.conversationSession ?? ''
}

/** Resolve the current chat's input facade; undefined when not ready. */
export function resolveInput(ctx: ClientContextLike, sessionId: string): SessionInputLike | undefined {
  try {
    const scope = ctx.sessions?.scope?.(sessionId)
    if (scope === undefined) return undefined
    const conversation = ctx.get?.('conversation') as { input?: { for(scope: unknown): SessionInputLike | undefined } } | undefined
    const input = conversation?.input?.for(scope)
    if (input === undefined || input === null) return undefined
    if (typeof input.setDraft !== 'function' || typeof input.state?.getSnapshot !== 'function') return undefined
    return input
  } catch {
    return undefined
  }
}

/** Append the block under the existing draft, preserving user text.
 *
 * Uses the scoped `insertText` verb when the host offers it. `setDraft` REBUILDS
 * the composer document, which silently drops the user's @file and quote chips
 * (the reason dsh-sidenote refuses setDraft while `occurrences` are present).
 * When only setDraft exists, a draft that carries chips is left untouched
 * rather than destroyed. */
export function appendToDraft(input: SessionInputLike, block: string): boolean {
  const state = input.state.getSnapshot()
  if (state.phase !== undefined && state.phase !== 'plain') return false
  const draft = typeof state.draft === 'string' ? state.draft : ''
  if (draft === block || draft.startsWith(`${block}\n\n`)) return true
  const prefix = draft.trimEnd() === '' ? block : `${block}\n\n`
  const next = `${prefix}${draft}`
  // A draft holding chips/pills must not go through the replace-everything verb.
  const hasChips = (state.occurrences?.length ?? 0) > 0
  if (typeof input.insertText === 'function' && typeof state.draftRev === 'number') {
    const applied = input.insertText(prefix, { start: 0, end: 0, draftRev: state.draftRev })
    const after = input.state.getSnapshot()
    return applied && after.draft === next
  }
  if (hasChips) return false
  input.setDraft(next)
  const after = input.state.getSnapshot()
  return after.draft === next
}

/** Write the batch into the composer without sending. */
export function sendToDraft(ctx: ClientContextLike, sessionId: string, block: string): { ok: boolean; reason?: string } {
  const input = resolveInput(ctx, sessionId)
  if (input === undefined) return { ok: false, reason: '当前会话输入框未就绪；批注已保留' }
  if (!appendToDraft(input, block)) return { ok: false, reason: '输入框正忙（发送中或引用模式）；批注已保留' }
  focusComposer()
  return { ok: true }
}

/** Direct submit: prefix + native submit() with rollback on rejection.
 * Returns true when the host accepted the admission. */
export async function sendDirect(ctx: ClientContextLike, sessionId: string, block: string): Promise<boolean> {
  const input = resolveInput(ctx, sessionId)
  if (!input || typeof input.submit !== 'function') return false
  const before = input.state.getSnapshot()
  if (before.phase !== 'plain') return false
  const receipt = observeAdmission(ctx, sessionId, block)
  // Hosts without a confirmation face retain the safe draft-only path.
  if (!receipt) return false
  if (!appendToDraft(input, block)) return false
  return receipt.start(() => input.submit!())
}

/** Put the caret at the end of the composer, best effort (cite-lens heuristic). */
export function focusComposer(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (doc === undefined) return
  const editor = doc.querySelector('[data-lexical-editor="true"][contenteditable="true"]')
    ?? doc.querySelector('form [contenteditable="true"], [role="textbox"][contenteditable="true"]')
  if (editor === null) return
  setTimeout(() => {
    try {
      ;(editor as HTMLElement).focus()
      const range = doc.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      const selection = doc.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    } catch { /* focus is a nicety */ }
  }, 30)
}

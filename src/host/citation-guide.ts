/**
 * Host half citation guide: teach each chat the annotation citation format so
 * the model can point back at places in the PDF, and the client turns those
 * into jumps. Grammar identical to cite-lens (tested in protocol/textsearch).
 *
 * Registered per agent on session start, fixed text, so the cached prompt
 * prefix holds; disposal rides the agent context effect.
 */

/** After TOOL_READ (1100) and before DELIVERABLE_FILE_REFERENCES (9000). */
export const SECTION_ORDER = 9400
export const SECTION_NAME = 'dsh-paper-margin'

export const CITATION_GUIDE = [
  '# Pointing at places in PDFs',
  '',
  'The web client turns PDF citations into links that open the PDF and highlight the spot. When you refer to a place in a PDF in this workspace — a passage you discuss, or text you just changed in its LaTeX/Markdown source — cite it like this:',
  '',
  '- `[main.pdf "exact words from that spot"]` — the page is found for you. Use this after editing the source: you usually do not know the page.',
  '- `[main.pdf p.7 "exact words from that spot"]` — when you know the page.',
  '- `[p.7]` — a page of the PDF the user is reading.',
  '',
  'Rules: copy 4–12 consecutive words exactly as they read in the rendered PDF — prose, not source markup (no commands, no `$…$`, no `\\cite`). Pick words that occur once. Use the path relative to the workspace when the PDF is not at its top level (`[build/main.pdf "…"]`). Text you just edited is found only after the PDF is rebuilt — say so if you have not rebuilt it.',
].join('\n')

/** Structural faces only; nothing from the host's internals is imported. */
interface AgentCtxLike {
  effect(fn: () => unknown, label?: string): unknown
  get(name: string): unknown
}

interface AgentPayload {
  agent?: {
    ctx?: AgentCtxLike
    session?: { id?: unknown }
  }
}

interface HostContextLike {
  on(event: string, handler: (payload: AgentPayload) => void): unknown
  logger?: { warn?(message: string): unknown }
}

export function applyCitationGuide(ctx: HostContextLike): void {
  // `agent/created` is the real event (the agent artifact lists
  // consumed-work, created, dispatch, disposed, inbox, pre-step, session).
  // An earlier `agent/session-start` was silently ignored — the guide never
  // reached any chat and the try/catch hid it.
  ctx.on('agent/created', (payload) => {
    const agentCtx = payload?.agent?.ctx
    if (agentCtx === undefined) return
    try {
      const prompt = agentCtx.get('systemPrompt') as { section?(section: { name: string; order: number; text: string }): unknown } | undefined
      if (typeof prompt?.section !== 'function') {
        ctx.logger?.warn?.('dsh-paper-margin: this host exposes no systemPrompt.section; the citation guide is off')
        return
      }
      agentCtx.effect(() => prompt.section!({ name: SECTION_NAME, order: SECTION_ORDER, text: CITATION_GUIDE }), 'dsh-paper-margin: citation guide')
    } catch (error) {
      ctx.logger?.warn?.(`dsh-paper-margin: citation guide not added to this chat: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

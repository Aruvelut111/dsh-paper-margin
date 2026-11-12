/**
 * Host half: the citation guide each chat's system prompt receives, and the
 * settings schema the settings card writes.
 *
 * There is deliberately NO HTTP route here. The reader obtains bytes through
 * the host's own `remote.workspaceFiles` Remote (injected in the client half),
 * which is the same primitive the built-in preview uses. An earlier design
 * served bytes over a private signed route; it needed its own key file, trust
 * fence and mint endpoint, and every one of those was a place for the reader to
 * fail with nothing visible to the user. Removing the route removed the failure
 * modes with it.
 */
import { applyCitationGuide } from './host/citation-guide'

export const name = 'dsh-paper-margin'

// The live presentation schema. Without a Config export the settings service
// lists no schema for this entry, so the client's configForms lookup stays
// 'unavailable' and the settings card's switch is permanently disabled. The
// value is volatile (presentation-only, never exported with session data).
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  directSubmit: z.boolean().default(false).volatile(),
})

/** Structural face of the host context this half touches. */
interface HostContext {
  get(name: string): unknown
  on?(event: string, handler: (payload: never) => void): unknown
  logger?: { warn?(message: string): unknown }
}

export function apply(ctx: HostContext): void {
  // Each chat's system prompt learns the citation format; the client turns
  // [main.pdf p.7 "words"] into jumps. Best effort per chat.
  try {
    applyCitationGuide(ctx as never)
  } catch (error) {
    console.warn('[dsh-paper-margin] citation guide unavailable', error)
  }
}

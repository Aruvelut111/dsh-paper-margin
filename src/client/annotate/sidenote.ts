/** Optional same-document capability; an unmodified sidenote declines cleanly. */
const EVENT = 'dsh-sidenote:external-annotation:v1'
export interface ReaderCapture { id?: string; sessionId: string; text: string; note?: string; source: { label: string; address?: string; page?: number; anchor?: import('./text-anchor').TextAnchor }; point?: { x: number; y: number }; edit?: boolean }
function request(action: 'probe' | 'add', capture?: ReaderCapture): boolean {
  let accepted = false
  document.dispatchEvent(new CustomEvent(EVENT, { detail: { action, capture, reply: (result: { accepted?: boolean }) => { accepted = result.accepted === true } } }))
  return accepted
}
export const sidenoteAvailable = () => request('probe')
export const captureInSidenote = (capture: ReaderCapture) => request('add', capture)
export function removeFromSidenote(sessionId: string, id?: number, captureId?: string): boolean {
  let accepted = false
  document.dispatchEvent(new CustomEvent(EVENT, { detail: { action: 'remove', sessionId, id, captureId, reply: (result: { accepted?: boolean }) => { accepted = result.accepted === true } } }))
  return accepted
}

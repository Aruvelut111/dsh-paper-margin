import type { Annotation, AnnotationStore } from './model.ts'

/** Versioned same-document seam for readers. No globals or storage coupling. */
export const EXTERNAL_ANNOTATIONS_EVENT = 'dsh-sidenote:external-annotation:v1'
export interface ExternalSource { readonly label: string; readonly address?: string; readonly page?: number; readonly anchor?: { exact: string; start: number; prefix: string; suffix: string } }
export interface ExternalCapture {
  id?: string
  sessionId: string
  text: string
  note?: string
  source: ExternalSource
  point?: { x: number; y: number }
  edit?: boolean
}
interface Request { action: 'probe' | 'add' | 'list' | 'edit' | 'remove'; capture?: ExternalCapture; sessionId?: string; id?: number; captureId?: string; point?: { x: number; y: number }; reply?: (result: { accepted: boolean; id?: number; items?: readonly Annotation[] }) => void }
export const EXTERNAL_REVEAL_EVENT = 'dsh-sidenote:reveal-external:v1'
export function revealExternalAnnotation(annotation: Annotation, target: EventTarget = document): void {
  if (annotation.externalSource) target.dispatchEvent(new CustomEvent(EXTERNAL_REVEAL_EVENT, { detail: { sessionId: annotation.sessionId, source: annotation.externalSource, text: annotation.anchorText } }))
}
export function registerExternalAnnotations(store: AnnotationStore, open: (annotation: Annotation, point: { x: number; y: number }, mode?: 'new' | 'edit') => void, target: EventTarget = document): () => void {
  const accepted = new Map<string, number>()
  const removed = new Set<string>()
  const receive = (event: Event) => {
    const request = (event as CustomEvent<Request>).detail
    if (!request || typeof request.reply !== 'function') return
    if (request.action === 'probe') { request.reply({ accepted: true }); return }
    if (request.action === 'list' && typeof request.sessionId === 'string') { request.reply({ accepted: true, items: store.list(request.sessionId).filter(item => item.externalSource !== undefined) }); return }
    if (request.action === 'remove' && request.sessionId && (typeof request.id === 'number' || typeof request.captureId === 'string')) {
      const key = request.captureId ? request.sessionId + ':' + request.captureId : undefined
      const annotation = typeof request.id === 'number' ? store.get(request.id) : store.list(request.sessionId).find(a => a.externalCaptureId === request.captureId)
      if (annotation && (!annotation.externalSource || annotation.sessionId !== request.sessionId || request.captureId && annotation.externalCaptureId !== request.captureId) || store.getSubmission(request.sessionId).pending) { request.reply({ accepted: false }); return }
      if (key) removed.add(key)
      if (annotation?.externalCaptureId) removed.add(annotation.sessionId + ':' + annotation.externalCaptureId)
      if (annotation) store.remove(annotation.id)
      request.reply({ accepted: true, id: annotation?.id }); return
    }
    if (request.action === 'edit' && typeof request.id === 'number') {
      const annotation = store.get(request.id)
      if (!annotation?.externalSource || annotation.sessionId !== request.sessionId || store.getSubmission(annotation.sessionId).pending) { request.reply({ accepted: false }); return }
      open(annotation, request.point ?? { x: 24, y: 100 }, 'edit')
      request.reply({ accepted: true, id: annotation.id }); return
    }
    const item = request.capture
    if (request.action !== 'add' || !item || !item.sessionId || typeof item.sessionId !== 'string' || typeof item.text !== 'string' || !item.text.trim() || !item.source || typeof item.source.label !== 'string' || typeof item.note !== 'undefined' && typeof item.note !== 'string') { request.reply({ accepted: false }); return }
    const captureKey = typeof item.id === 'string' ? item.sessionId + ':' + item.id : undefined
    if (captureKey && removed.has(captureKey)) { request.reply({ accepted: true }); return }
    const previous = captureKey ? accepted.get(captureKey) ?? store.list(item.sessionId).findLast(annotation => annotation.externalCaptureId === item.id)?.id : undefined
    if (previous !== undefined) {
      const existing = store.get(previous)
      // Retries belong to the original capture, even after send/delete.
      // A new selection receives a new id instead of resurrecting an old one.
      if (!existing || existing.state === 'sent') { request.reply({ accepted: true, id: previous }); return }
      if (store.getSubmission(item.sessionId).pending) { request.reply({ accepted: false }); return }
      if (existing) {
        if (item.note !== undefined && existing.note !== item.note) store.setNote(previous, item.note)
        if (captureKey) accepted.set(captureKey, previous)
        request.reply({ accepted: true, id: previous }); return
      }
    }
    const anchor = item.source.anchor
    const source = { label: item.source.label, ...(typeof item.source.address === 'string' ? { address: item.source.address } : {}), ...(Number.isSafeInteger(item.source.page) && item.source.page! > 0 ? { page: item.source.page } : {}), ...(anchor && typeof anchor.exact === 'string' && Number.isSafeInteger(anchor.start) && anchor.start >= 0 && typeof anchor.prefix === 'string' && typeof anchor.suffix === 'string' ? { anchor: { exact: anchor.exact, start: anchor.start, prefix: anchor.prefix.slice(-128), suffix: anchor.suffix.slice(0, 128) } } : {}) }
    const annotation = store.add({ sessionId: item.sessionId, text: `[${source.label}]
${item.text}`, anchorText: item.text, anchorKey: undefined, occurrence: 0, note: item.note ?? '', externalSource: source, externalCaptureId: item.id })
    if (item.edit !== false) open(annotation, { x: Number.isFinite(item.point?.x) ? item.point!.x : 24, y: Number.isFinite(item.point?.y) ? item.point!.y : 100 })
    if (captureKey) accepted.set(captureKey, annotation.id)
    request.reply({ accepted: true, id: annotation.id })
  }
  target.addEventListener(EXTERNAL_ANNOTATIONS_EVENT, receive)
  const unsubscribe = store.subscribe(() => target.dispatchEvent(new Event('dsh-sidenote:external-annotations-changed')))
  target.dispatchEvent(new Event('dsh-sidenote:external-annotations-changed'))
  return () => { unsubscribe(); target.removeEventListener(EXTERNAL_ANNOTATIONS_EVENT, receive); target.dispatchEvent(new Event('dsh-sidenote:external-annotations-changed')) }
}

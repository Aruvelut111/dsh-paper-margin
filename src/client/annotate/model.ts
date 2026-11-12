/**
 * Annotation model: pure anchor identity, stale detection, and store shape.
 *
 * Pure logic layer (no react, no DOM) so vitest covers everything that can
 * silently corrupt user data: anchor identity, quote normalization, and the
 * stale verdict after a file change.
 */
import type { Annotation, AnnotationAnchor } from '../../contract'

/** The live store: per-file annotation lists, persisted to localStorage. */
export interface AnnotationStoreShape {
  version: number
  annotations: Annotation[]
}

export const STORE_VERSION = 1

/** Storage key per Files-tab address; the address is the file identity. */
export function storageKeyOf(address: string): string {
  return `dsh-paper-margin:store:v1:${address}`
}

/** Collapse a pdf.js text-layer selection into clean prose (cite-lens rules). */
export function cleanSelection(text: string): string {
  return String(text ?? '')
    .replace(/\u00ad/g, '')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/[ \t\u00a0]{2,}/g, ' ')
    .trim()
}

/** New annotation from a live selection on any surface. */
export function createAnnotation(input: {
  id: string
  file: string
  page: number
  quote: string
  rects: AnnotationAnchor['rects']
  note?: string
  createdAt: number
  kind?: string
  where?: string
  line?: number
  sessionId?: string
  sourceAddress?: string
}): Annotation {
  return {
    id: input.id,
    file: input.file,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.sourceAddress ? { sourceAddress: input.sourceAddress } : {}),
    anchor: {
      page: input.page,
      quote: cleanSelection(input.quote),
      rects: input.rects,
      order: orderOf(input.rects),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.where !== undefined ? { where: input.where } : {}),
      ...(input.line !== undefined ? { line: input.line } : {}),
    },
    note: input.note ?? '',
    createdAt: input.createdAt,
    state: 'active',
  }
}

/** Reading order of one anchor on its page: top-to-bottom, left-to-right. */
export function orderOf(rects: AnnotationAnchor['rects']): number {
  if (rects.length === 0) return Number.MAX_SAFE_INTEGER
  const first = rects[0]!
  return first.y * 10_000 + first.x
}

/** Whether a stored anchor still matches re-extracted page text.
 * Forgiving like cite-lens matching: whitespace, hyphenation, quotes and
 * case collapse before the comparison. */
export function isAnchorStale(anchor: AnnotationAnchor, pageText: string): boolean {
  const quote = normalizeForMatch(anchor.quote)
  if (quote === '') return false
  return !normalizeForMatch(pageText).includes(quote)
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, '"')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Merge one edited annotation back into the list; keeps list identity stable. */
export function upsertAnnotation(list: readonly Annotation[], next: Annotation): Annotation[] {
  const index = list.findIndex((a) => a.id === next.id)
  if (index < 0) return [...list, next]
  const copy = [...list]
  copy[index] = next
  return copy
}

/** Mark the batch sent; only annotations still present flip state. */
export function markSent(list: readonly Annotation[], ids: readonly string[]): Annotation[] {
  const wanted = new Set(ids)
  return list.map((a) => (wanted.has(a.id) && a.state === 'active' ? { ...a, state: 'sent' } : a))
}

/** Load tolerant: any corruption yields an empty store, never a throw. */
export function reviveStore(raw: string | null): AnnotationStoreShape {
  if (raw === null || raw === '') return { version: STORE_VERSION, annotations: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<AnnotationStoreShape>
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.annotations)) {
      return { version: STORE_VERSION, annotations: [] }
    }
    // A single malformed legacy row must not disable every readable note.
    return { version: STORE_VERSION, annotations: parsed.annotations.filter(isAnnotation) }
  } catch {
    return { version: STORE_VERSION, annotations: [] }
  }
}

export function isAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== 'object') return false
  const a = value as Annotation
  const p = a.anchor
  return typeof a.id === 'string' && a.id.length > 0 && typeof a.file === 'string'
    && typeof a.note === 'string' && Number.isFinite(a.createdAt)
    && (a.state === 'active' || a.state === 'sent')
    && (a.sessionId === undefined || typeof a.sessionId === 'string')
    && (a.sourceAddress === undefined || typeof a.sourceAddress === 'string')
    && !!p && Number.isSafeInteger(p.page) && p.page >= 0 && typeof p.quote === 'string'
    && Number.isFinite(p.order) && Array.isArray(p.rects)
    && (p.where === undefined || typeof p.where === 'string')
    && p.rects.every(r => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w >= 0 && r.h >= 0)
}

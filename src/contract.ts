/** Shared persistent annotation shape and escaped model message format. */
/** Wire schema version. Bump when anchor or batch fields change shape. */
export const WIRE_VERSION = 1

/**
 * Annotation anchor: stable identity of one annotated passage.
 * `quote` is the cleaned selection text (never truncated — the sidenote
 * discipline); `rects` locate it visually on a page. Surfaces without pages
 * (diff, code, markdown, terminal, chat) carry `line` or only `where` instead,
 * so one annotation shape covers every surface without a second schema.
 */
export interface AnnotationAnchor {
  /** 1-based page; 0 when the surface has no pages. */
  readonly page: number
  readonly quote: string
  readonly rects: readonly { x: number; y: number; w: number; h: number }[]
  readonly order: number
  /** 1-based line inside the surface, when derivable (diff/code/markdown). */
  readonly line?: number
  /** Which surface: pdf | office | diff | code | file | markdown | terminal | chat. */
  readonly kind?: string
  /** Human location label shown in the panel, e.g. "p.7" or "第 12 行". */
  readonly where?: string
}

export interface Annotation {
  readonly id: string
  readonly file: string
  readonly sessionId?: string
  readonly sourceAddress?: string
  readonly anchor: AnnotationAnchor
  readonly note: string
  readonly createdAt: number
  readonly state: 'active' | 'sent'
}

/** One annotation serialized into the sidenote-compatible XML protocol block. */
export function formatAnnotationXml(annotation: Annotation, index: number): string {
  const quote = annotation.anchor.quote
  const note = annotation.note.trim()
  // Pages when the surface has them; the surface label otherwise. One locator
  // grammar keeps the model's citations uniform across PDF, diff and code.
  const where = annotation.anchor.where !== undefined && annotation.anchor.where !== ''
    ? `${annotation.file} · ${annotation.anchor.where}`
    : annotation.anchor.page > 0
      ? `${annotation.file} · p.${annotation.anchor.page}`
      : annotation.file
  // sidenote accepts scope, but not arbitrary attributes. Keep the visible
  // source in the quote too: its bubble parser intentionally ignores scope.
  const head = `<annotation id="${index}" scope="${escapeAttr(where)}" encoding="xml">`
  const locatedQuote = `[${where}]\n${quote}` + (annotation.sourceAddress ? `\n[Source: ${annotation.sourceAddress}]` : '')
  return note === ''
    ? `${head}\n<quote>${escapeXml(locatedQuote)}</quote>\n</annotation>`
    : `${head}\n<quote>${escapeXml(locatedQuote)}</quote>\n<note>${escapeXml(note)}</note>\n</annotation>`
}

/** Protocol block header, bilingual like the sidenote wire. */
export function protocolHeader(count: number): string {
  return `我批注了以下 ${count} 处内容：`
}

/** The full prefix block: header + one XML block per annotation. */
export function buildProtocolBlock(annotations: readonly Annotation[]): string {
  return [protocolHeader(annotations.length), ...annotations.map((a, i) => formatAnnotationXml(a, i + 1))].join('\n')
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(value: string): string {
  return escapeXml(value)
}

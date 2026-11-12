/**
 * Find quoted words in a PDF page and where they sit.
 *
 * Port of the cite-lens validated algorithm (MIT, adithyanraj03/dsh-cite-lens):
 * searches pdf.js text content — not the rendered text layer — so a page can
 * be located before it is drawn. Matching forgives what a model cannot know:
 * line breaks, cross-line hyphenation, ligatures, curly vs straight quotes,
 * dash styles, spacing and case. A second, looser pass drops punctuation.
 *
 * Ported rather than imported because the client bundle inlines everything and
 * the algorithm is stable, self-contained, and covered by tests here.
 */

/** One character of normalized page text, and where it came from. */
function pushChar(out: { chars: string[]; src: unknown[] }, ch: string, item: number, offset: number): void {
  out.chars.push(ch)
  out.src.push(item, offset)
}

const DASHES = /[‐-―−]/g
const QUOTES_S = /[‘’‚‛′]/g
const QUOTES_D = /[“”„‟″]/g

/** Fold one piece of text the same way page text is folded. */
function fold(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\u00ad/g, '')
    .replace(DASHES, '-')
    .replace(QUOTES_S, "'")
    .replace(QUOTES_D, '"')
    .toLowerCase()
}

export interface TextItem {
  str?: string
  hasEOL?: boolean
  transform?: number[]
  width?: number
  height?: number
}

export interface PageIndex {
  text: string
  src: unknown[]
}

/** Page text as one normalized string, each char mapped to (item, offset). */
export function indexPage(items: readonly TextItem[], loose = false): PageIndex {
  const out = { chars: [] as string[], src: [] as unknown[] }
  let lastSpace = true
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as TextItem
    const str = typeof item?.str === 'string' ? item.str : ''
    for (let j = 0; j < str.length; j += 1) {
      for (const ch of fold(str[j] ?? '')) {
        if (/\s/.test(ch)) {
          if (!loose && !lastSpace) pushChar(out, ' ', i, j)
          lastSpace = true
        } else if (loose && !/[\p{L}\p{N}]/u.test(ch)) {
          // punctuation dropped in the loose pass
        } else {
          pushChar(out, ch, i, j)
          lastSpace = false
        }
      }
    }
    if (item?.hasEOL === true || i === items.length - 1) {
      // A word hyphenated across the line break joins up: "evalu-" + "ation".
      const n = out.chars.length
      if (!loose && n >= 2 && out.chars[n - 1] === '-' && /[\p{L}]/u.test(out.chars[n - 2] ?? '')) {
        out.chars.pop()
        out.src.length -= 2
        lastSpace = true
        continue
      }
      if (!loose && !lastSpace) {
        pushChar(out, ' ', i, str.length)
        lastSpace = true
      }
    } else if (!loose && str !== '' && !lastSpace && items[i + 1] !== undefined
      && /^\s/.test(items[i + 1]?.str ?? '') === false
      && Math.abs(((items[i + 1] as TextItem)?.transform?.[5] ?? 0) - (item.transform?.[5] ?? 0)) > 0.5 * (item.height || 10)) {
      // Next item on another line without hasEOL: treat as a break.
      pushChar(out, ' ', i, str.length)
      lastSpace = true
    }
  }
  return { text: out.chars.join(''), src: out.src }
}

/** The query folded the same way. */
export function foldQuery(query: string, loose = false): string {
  const folded = fold(String(query ?? ''))
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
    .replace(/(\p{L})-\s+(\p{L})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
  return loose ? folded.replace(/[^\p{L}\p{N}]/gu, '') : folded
}

export interface ItemSpan {
  item: number
  from: number
  to: number
}

/** Find a quote in one page's text items; per-item character spans, or null. */
export function findInItems(items: readonly TextItem[], query: string): ItemSpan[] | null {
  for (const loose of [false, true]) {
    const q = foldQuery(query, loose)
    if (q.length < (loose ? 4 : 3)) continue
    const page = indexPage(items, loose)
    const at = page.text.indexOf(q)
    if (at < 0) continue
    const spans = new Map<number, ItemSpan>()
    for (let k = at; k < at + q.length; k += 1) {
      const item = page.src[k * 2] as number
      const offset = page.src[k * 2 + 1] as number
      const span = spans.get(item)
      if (span !== undefined) {
        span.from = Math.min(span.from, offset)
        span.to = Math.max(span.to, offset + 1)
      } else {
        spans.set(item, { item, from: offset, to: offset + 1 })
      }
    }
    return [...spans.values()]
      .map((s) => ({ ...s, to: Math.min(s.to, (items[s.item]?.str ?? '').length) }))
      .filter((s) => s.to > s.from)
      .sort((a, b) => a.item - b.item)
  }
  return null
}

export interface FractionBox {
  x: number
  y: number
  w: number
  h: number
}

interface ViewportLike {
  width: number
  height: number
  convertToViewportPoint(x: number, y: number): [number, number]
}

/** Boxes for matched spans, as fractions of the page. */
export function boxesFor(spans: readonly ItemSpan[], items: readonly TextItem[], viewport: ViewportLike): FractionBox[] {
  const boxes: FractionBox[] = []
  for (const { item: index, from, to } of spans) {
    const item = items[index] as TextItem
    const t = item.transform ?? [0, 0, 0, 0, 0, 0]
    const len = Math.max(1, (item.str ?? '').length)
    const fontHeight = item.height || Math.hypot(t[2] ?? 0, t[3] ?? 0) || 10
    const x = t[4]! + ((item.width ?? 0) * from) / len
    const w = ((item.width ?? 0) * (to - from)) / len
    const y0 = t[5]! - fontHeight * 0.22
    const y1 = t[5]! + fontHeight * 0.92
    const [ax, ay] = viewport.convertToViewportPoint(x, y0)
    const [bx, by] = viewport.convertToViewportPoint(x + w, y1)
    const left = Math.min(ax, bx)
    const top = Math.min(ay, by)
    boxes.push({
      x: left / viewport.width,
      y: top / viewport.height,
      w: Math.abs(bx - ax) / viewport.width,
      h: Math.abs(by - ay) / viewport.height,
    })
  }
  return boxes.filter((b) => b.w > 0 && b.h > 0)
}

/** Pages to search: the hinted one, its neighbours, then the rest in order. */
export function searchOrder(numPages: number, hint?: number): number[] {
  const order: number[] = []
  const seen = new Set<number>()
  const add = (n: number): void => {
    if (n >= 1 && n <= numPages && !seen.has(n)) {
      seen.add(n)
      order.push(n)
    }
  }
  if (hint !== undefined) for (const d of [0, 1, -1, 2, -2]) add(hint + d)
  for (let n = 1; n <= numPages; n += 1) add(n)
  return order
}

/**
 * PDF citation grammar — identical shape to cite-lens so the model-facing
 * guide can be shared verbatim. Every part optional, but a file or a page
 * must exist; nothing but separators may remain between the brackets.
 *   [p.17]  [pp.4-5]  [main.pdf p.9]  [main.pdf "exact words"]
 * Returns { page?, file?, quote? } or null.
 */
export interface ParsedCitation {
  page?: number
  file?: string
  quote?: string
}

const QUOTE_RE = /["“”]([^"“”]{2,400})["“”]/
const FILE_RE = /^\s*([^\s"“”·,;:][^"“”·,;]*?\.pdf)(?=$|[\s·,;:])/i
const PAGE_RE = /\b(?:pp?|pages?)\.?\s?(\d{1,4})(?:\s*[-–]\s*\d{1,4})?/gi
const SEPARATORS_ONLY = /^[\s·,;:–—-]*$/

export function parseCitation(inner: string): ParsedCitation | null {
  let rest = inner
  let quote: string | undefined
  const quoted = QUOTE_RE.exec(rest)
  if (quoted !== null) {
    quote = quoted[1]?.trim()
    rest = `${rest.slice(0, quoted.index)} ${rest.slice(quoted.index + quoted[0].length)}`
  }
  let file: string | undefined
  const named = FILE_RE.exec(rest)
  if (named !== null) {
    file = named[1]?.trim().replace(/\\/g, '/')
    rest = rest.slice(named.index + named[0].length)
  }
  const pages: number[] = []
  rest = rest.replace(PAGE_RE, (_m: string, n: string) => {
    pages.push(Number(n))
    return ' '
  })
  if (pages.length > 0) rest = rest.replace(/(^|[,;])\s*\d{1,4}(?=\s*($|[,;]))/g, '$1 ')
  if (SEPARATORS_ONLY.test(rest)) {
    const page = pages[0]
    if (file === undefined && page === undefined) return null
    if (page !== undefined && !(Number.isInteger(page) && page >= 1)) return null
    return {
      ...(page !== undefined ? { page } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(quote !== undefined ? { quote } : {}),
    }
  }
  return null
}

/** All PDF citations in one text node's value, with positions. */
export function findPageCitations(text: string): Array<{ index: number; length: number } & ParsedCitation> {
  const out: ({ index: number; length: number } & ParsedCitation)[] = []
  const outer = /\[([^[\]\n]{1,420})\]/g
  let match: RegExpExecArray | null
  while ((match = outer.exec(text)) !== null) {
    const parsed = parseCitation(match[1] ?? '')
    if (parsed !== null) out.push({ index: match.index, length: match[0].length, ...parsed })
  }
  return out
}

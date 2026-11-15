import type { PageRead, PageOutcome } from '../../browser-contract'

/** Serialized into the existing Electron guest. Keep this function self-contained. */
export function readNativeDocument(win: Window, request: PageRead): PageOutcome {
  const fail = (code: string, message: string): PageOutcome => ({ ok: false, code, message })
  if (win.location.href !== request.expectedUrl) return fail('PAGE_CHANGED', 'This tab has navigated. List pages and confirm the source URL before reading again.')
  const body = win.document.body
  const full = body?.innerText
  if (typeof full !== 'string') return fail('PAGE_NOT_READY', 'The page has no rendered body text yet.')
  // Chromium owns rendered-text extraction. Do it only on an explicit tool
  // request: no article reparser, DOM clone, content observer, or scroll work.
  const text = full.slice(0, 1_000_000)
  const readerWindow = win as Window & { __paperMarginReadDocument?: string }
  // randomUUID is secure-context-only; DSH also opens ordinary HTTP pages.
  const identity = readerWindow.__paperMarginReadDocument ??= Array.from(win.crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16)).join('-')
  let hash = 2166136261
  let hash2 = 5381
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    hash = Math.imul(hash ^ code, 16777619)
    hash2 = Math.imul(hash2, 33) ^ code
  }
  const version = identity + ':' + (hash >>> 0).toString(36) + ':' + (hash2 >>> 0).toString(36) + ':' + full.length
  if (request.version !== undefined && request.version !== version) return fail('CONTENT_CHANGED', 'The page text changed. Restart the read or search at offset 0.')
  const offset = request.offset ?? 0
  if (offset > 0 && !request.version) return fail('VERSION_REQUIRED', 'Continuation requires the version returned by the first read or search.')
  if (offset > text.length) return fail('OFFSET_OUT_OF_RANGE', 'Offset exceeds the currently readable page text.')
  const value: import('../../browser-contract').PageContent = {
    pageId: request.pageId, url: win.location.href, title: win.document.title.slice(0, 500),
    readAt: new Date().toISOString(), version, scope: 'rendered-main-document',
    totalCharacters: full.length, readableCharacters: text.length, textLimitReached: full.length > text.length,
    embeddedFrames: win.document.querySelectorAll('iframe,frame').length, offset, nextOffset: null,
  }
  if (request.action === 'find') {
    const query = request.query!
    const matches: { offset: number; text: string }[] = []
    let cursor = offset
    while (matches.length < 5) {
      const index = text.indexOf(query, cursor)
      if (index < 0) break
      matches.push({ offset: index, text: text.slice(Math.max(0, index - 160), Math.min(text.length, index + query.length + 160)) })
      cursor = index + query.length
    }
    value.matches = matches
    if (matches.length === 5 && text.indexOf(query, cursor) >= 0) value.nextOffset = cursor
  } else {
    const end = Math.min(text.length, offset + (request.limit ?? 12_000))
    value.text = text.slice(offset, end)
    value.nextOffset = end < text.length ? end : null
  }
  return { ok: true, value }
}


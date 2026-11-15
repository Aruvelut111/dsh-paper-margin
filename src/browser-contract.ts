/** Shared JSON-only protocol; the initiating agent supplies the session, never tool arguments. */
export const BROWSER_ROUTE = '/api/paper-margin/browser'
export const MAX_PAGE_TEXT = 1_000_000
export const MAX_READ_CHARS = 20_000

export interface NativePage {
  id: string
  sessionId: string
  url: string
  title: string
  visible: boolean
}
export interface PageRead {
  action: 'read' | 'find'
  pageId: string
  expectedUrl: string
  offset?: number
  limit?: number
  query?: string
  version?: string
}
export interface PageContent {
  pageId: string
  url: string
  title: string
  readAt: string
  version: string
  scope: 'rendered-main-document'
  totalCharacters: number
  readableCharacters: number
  textLimitReached: boolean
  embeddedFrames: number
  offset: number
  nextOffset: number | null
  text?: string
  matches?: { offset: number; text: string }[]
}
export type PageOutcome = { ok: true; value: PageContent } | { ok: false; code: string; message: string }
export interface PageCommand {
  id: string
  sessionId: string
  request: PageRead
}
export function pageFailure(code: string, message: string): PageOutcome {
  return { ok: false, code, message }
}
export function validRead(value: unknown): value is PageRead {
  if (!value || typeof value !== 'object') return false
  const r = value as PageRead
  return (r.action === 'read' || r.action === 'find')
    && typeof r.pageId === 'string' && r.pageId.length > 0 && r.pageId.length <= 100
    && typeof r.expectedUrl === 'string' && /^https?:\/\//i.test(r.expectedUrl) && r.expectedUrl.length <= 8192
    && (r.offset === undefined || Number.isSafeInteger(r.offset) && r.offset >= 0 && r.offset <= MAX_PAGE_TEXT)
    && (r.limit === undefined || Number.isSafeInteger(r.limit) && r.limit > 0 && r.limit <= MAX_READ_CHARS)
    && (r.version === undefined || typeof r.version === 'string' && r.version.length <= 200)
    && (r.action !== 'find' || typeof r.query === 'string' && r.query.length > 0 && r.query.length <= 2000)
}


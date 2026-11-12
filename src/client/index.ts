/**
 * Client half entry: the paper-margin PDF reader, the universal selection
 * annotator, the citation link layer, and the settings card.
 *
 * The PDF preview registers through `documentPreviews` with priority
 * 'extension': the registry keeps every definition alive and the viewer picker
 * exposes the built-in one, so nothing is destroyed and uninstalling restores
 * stock behavior automatically.
 *
 * Office files are deliberately NOT registered. The host's built-in preview
 * already handles docx/xlsx/pptx through its own converter, and claiming those
 * extensions pushed this plugin's preview ahead of it (extension beats builtin)
 * while lacking the host converter's file support.
 */
import { applyPreview } from './viewer/preview'
import { PdfViewRegistry } from './viewer/registry'
import { installPageLinks } from './protocol/pagelinks'
import { attachUniversalAnnotator, type CapturedSelection } from './annotate/universal'
import { createAnnotation } from './annotate/model'
import { provideStore } from './annotate/store'
import { installNotebook } from './annotate/notebook'
import { attachWebAnnotations } from './annotate/web'
import { createMarginPreferences } from './preferences'
import { registerMarginSettings } from './settings'
import { currentSessionId } from './protocol/composer'
import { captureInSidenote, sidenoteAvailable } from './annotate/sidenote'
import { registerAnnotationDock } from './annotate/composer-dock'
import { attachExcelAnnotations } from './annotate/excel'
import { attachImageAnnotations } from './annotate/image'
import { registerHtmlPreview } from './viewer/html-preview'
import { attachDocumentNotes } from './annotate/document-notes'
import { attachExternalReveal } from './annotate/reveal'

export const inject = [
  'slots',
  'documentPreviews',
  'conversation',
  'sessions',
  'locale',
  'sidebarRight',
  // The reader's byte source. Declaring the Remote row (the same specifier the
  // host's own document preview injects) is what makes `ctx.remote.workspaceFiles`
  // available; without it the reader has no way to read a file at all.
  'remote.workspaceFiles',
  'remote',
]

export function apply(ctx: unknown): void {
  // cordis reports a failed client half as a bare "entry did not activate", so
  // a throw here would be invisible. Record the real error for inspection,
  // then rethrow so the host still sees a truthful failure.
  try {
    applyInner(ctx)
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    ;(globalThis as { __dshPaperMarginError?: string }).__dshPaperMarginError = message
    try { console.error('[dsh-paper-margin] activate failed:', message) } catch { /* no console */ }
    throw error
  }
}

function applyInner(ctx: unknown): void {
  const c = ctx as Record<string, unknown> & {
    effect?(fn: () => unknown, label?: string): unknown
    get(name: string): unknown
  }
  // Shared state lives in module singletons, never on ctx: the client ctx is a
  // guarded proxy that throws on unknown property writes.
  const registry = sharedRegistry()
  try {
    registry.currentSessionId = () => currentSessionId(c as never) || undefined
  } catch { /* sessions not ready: citations resolve without a session */ }

  applyPreview(ctx as never, registry)

  // Settings card controls the standalone direct-send button visibility.
  // configForms is read through ctx.get (sidenote's pattern): the settings
  // service is up long before any reader opens.
  try {
    const forms = c.get('configForms') as
      | { get(namespace: string): import('./preferences').MarginConfigForm }
      | undefined
    if (forms !== undefined) {
      const preferences = createMarginPreferences(forms.get('paper-margin'))
      setSharedPreferences(preferences)
      c.effect?.(() => () => { preferences.dispose() }, 'dsh-paper-margin: preferences')
      registerMarginSettings(ctx, preferences)
    }
  } catch { /* settings are optional: the default (draft-only) stands */ }

  // Citation links over chat replies.
  try {
    const effect = installPageLinks(registry, document, {
      // The host's openResource returns nothing (it delegates to the navigator),
      // so a truthiness test on its result is always false and every jump
      // claimed the file could not be opened. Treat "no exception" as accepted
      // and let the registry confirm the view actually appeared.
      open: (address: string) => {
        const sidebar = c.sidebarRight as { openResource?(address: string): unknown } | undefined
        if (typeof sidebar?.openResource !== 'function') return false
        try {
          sidebar.openResource(address)
          return true
        } catch {
          return false
        }
      },
      notify: (message: string) => {
        console.info('[dsh-paper-margin]', message)
      },
    })
    c.effect?.(() => effect, 'dsh-paper-margin: page links')
  } catch { /* citations enhance, never gate */ }

  // One annotator for every selectable surface outside this plugin's own PDF
  // view: file preview, diff, code, markdown, terminal, chat. The PDF reader
  // keeps its own capture so a selection never yields two toolbars.
  try {
    const store = provideStore(c as never)
    const notebook = installNotebook(c as never, store, (annotation) => {
      if (annotation.sourceAddress) {
        const sidebar = c.sidebarRight as { openResource?(address: string): void } | undefined
        sidebar?.openResource?.(annotation.sourceAddress)
      }
    })
    c.effect?.(() => () => notebook.dispose(), 'dsh-paper-margin: notebook')
    c.effect?.(() => registerAnnotationDock(c as never, store, notebook), 'dsh-paper-margin: composer dock')
    const capture = (captured: CapturedSelection) => {
        const file = captured.file || labelOf(captured)
        const sessionId = captured.sessionId
        if (!sessionId) return '无法确定目标会话，未添加；请重新打开文件'
        if (captureInSidenote({ id: captured.id, sessionId, text: captured.quote, note: captured.note, source: { label: `${file}${captured.where ? ` · ${captured.where}` : ''}`, address: captured.sourceAddress, page: captured.page, anchor: captured.anchor }, point: captured.point, edit: captured.kind !== 'web' && captured.note === undefined })) return undefined
        if (sidenoteAvailable()) return '批注正在发送，请稍后重试'
        const key = `surface:${sessionId}:${captured.sourceAddress || captured.kind}`
        const id = captured.id || `pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
        if (store.list(key).some(a => a.id === id)) { if (captured.note !== undefined) store.update(key, id, captured.note); return { update: (note: string) => store.update(key, id, note) } }
        store.add(key, createAnnotation({
          id,
          file,
          sessionId,
          sourceAddress: captured.sourceAddress,
          page: captured.page ?? 0,
          quote: captured.quote,
          note: captured.note,
          rects: [],
          createdAt: Date.now(),
          kind: captured.kind,
          where: captured.where,
          line: captured.line,
        }))
        return { update: (note: string) => store.update(key, id, note) }
      }
    const annotator = attachUniversalAnnotator({ onAnnotate: capture })
    registerHtmlPreview(ctx, capture)
    c.effect?.(() => attachDocumentNotes(), 'dsh-paper-margin: saved document notes')
    c.effect?.(() => attachExternalReveal(registry, address => (c.sidebarRight as { openResource?(address: string): void })?.openResource?.(address), message => {
      const notice = document.createElement('div'); notice.setAttribute('role', 'status'); notice.textContent = message; notice.style.cssText = 'position:fixed;bottom:24px;left:50%;z-index:2147483000;padding:10px 16px;background:#26344a;color:white;border-radius:7px'; document.body.append(notice); setTimeout(() => notice.remove(), 3500)
    }), 'paper-margin: reveal external source')
    const web = attachWebAnnotations(capture, address => (c.sidebarRight as { openTab?(type: string, options: {params:{url:string}}): void })?.openTab?.('browser', {params:{url:address}}))
    c.effect?.(() => attachExcelAnnotations(capture), 'dsh-paper-margin: spreadsheet annotator')
    c.effect?.(() => attachImageAnnotations(capture), 'dsh-paper-margin: image annotator')
    c.effect?.(() => web, 'dsh-paper-margin: web annotator')
    // effect(fn) CALLS fn and treats its return value as the disposer, so the
    // installer must be wrapped: passing it directly would run it once here and
    // register its return value as a no-op disposer.
    c.effect?.(() => annotator, 'dsh-paper-margin: universal annotator')
    ;(globalThis as { __dshPaperMarginAnnotator?: string }).__dshPaperMarginAnnotator = 'installed'
  } catch (error) {
    // Annotation is the plugin's whole point: a silent failure here is worse
    // than a noisy one, so record it where the page can be inspected.
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    ;(globalThis as { __dshPaperMarginAnnotator?: string }).__dshPaperMarginAnnotator = `failed: ${message}`
    console.error('[dsh-paper-margin] annotator failed:', message)
  }
}

/** A stable, human label for one captured selection's source surface. */
function labelOf(captured: CapturedSelection): string {
  if (captured.kind === 'markdown') return 'Markdown 文档'
  if (captured.kind === 'diff') return 'Diff 视图'
  if (captured.kind === 'code') return '代码块'
  if (captured.kind === 'terminal') return '终端'
  if (captured.kind === 'chat') return '对话'
  return '文件'
}

/** Module-level registry: one per client root, never on the guarded ctx. */
let registry: PdfViewRegistry | undefined

export function sharedRegistry(): PdfViewRegistry {
  if (registry === undefined) registry = new PdfViewRegistry()
  return registry
}

/** Live presentation preference shared by the standalone panels. */
let sharedPreferences: import('./preferences').MarginPreferences | undefined

export function setSharedPreferences(preferences: import('./preferences').MarginPreferences): void {
  sharedPreferences = preferences
}

export function getSharedPreferences(): import('./preferences').MarginPreferences | undefined {
  return sharedPreferences
}

import { parseFileAddress } from './address'
/** PDF renderer registration over the host workspace-files ranged Remote. */
import { buildProtocolBlock, type Annotation } from '../../contract'
import { h } from '../h'
import { createAnnotation } from '../annotate/model'
import { provideStore, type AnnotationStore } from '../annotate/store'
import { renderAnnotationPanel } from '../annotate/panel'
import { attachSelectionCapture } from '../annotate/selection'
import { currentSessionId, sendToDraft, sendDirect } from '../protocol/composer'
import { openPdfView } from './pdf-view'
import { openWorkspaceSource, type WorkspaceFilesRemote } from './byte-source'
import { ensureStyles } from './styles'
import { captureInSidenote, sidenoteAvailable } from '../annotate/sidenote'
import { attachPdfBadges } from '../annotate/pdf-badges'
import { readerSessionId } from '../annotate/reader-surface'
import { getSharedPreferences } from '../index'
import type { PdfViewRegistry } from './registry'

const PREVIEW_ID = 'dsh-paper-margin/pdf'

interface ClientContext {
  effect(fn: () => unknown, label?: string): unknown
  documentPreviews: { register(definition: Record<string, unknown>, label?: string): unknown }
  slots: {
    inject(name: string, factory: () => unknown): unknown
    register(definition: Record<string, unknown>, component: unknown): unknown
  }
  sessions?: {
    list?: { getSnapshot?(): { current?: string } }
    scope?(id: string): unknown
  }
  /** The host's Remote face; `workspaceFiles` is the range reader this reader
   * uses instead of a private HTTP route. */
  remote?: { workspaceFiles?: WorkspaceFilesRemote }
  get?(name: string): unknown
}

export function applyPreview(ctx: ClientContext, registry: PdfViewRegistry): void {
  const store = provideStore(ctx as never)
  // The text layer is only selectable with its stylesheet; install it before
  // any preview mounts so a first-open PDF can be annotated immediately.
  ensureStyles()

  ctx.effect(() => ctx.documentPreviews.register({
    id: PREVIEW_ID,
    extensions: ['pdf'],
    binaryExtensions: ['pdf'],
    priority: 'extension',
    title: () => 'Paper Margin',
    // Renderer mode avoids the host complete-file read and its size cap.
    loading: 'renderer',
    wrap: false,
  }), 'dsh-paper-margin: preview type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document',
    key: PREVIEW_ID,
  }, (props: BodyProps) => PdfMarginBody(props, ctx, store, registry))), 'dsh-paper-margin: preview body')
}

interface BodyProps {
  /** Present only for 'bytes-complete' definitions; a 'renderer' body receives
   * a renderer coordinator and fetches bytes itself. */
  content?: {
    kind: string
    data?: Uint8Array
    /** Renderer content revision. `loaded(version)` MUST echo this value or the
     * host's `rendered` action ignores the call (it guards on
     * `state.loadRevision !== revision`) and the tab stays "loading" forever. */
    revision?: number
    loaded?: (version: string) => void
    failed?: () => void
    reload?: unknown
  }
  resourceAddress?: string
}

type Status = { phase: 'loading' } | { phase: 'ready'; pages: number; mode: string } | { phase: 'error'; message: string }

function PdfMarginBody(props: BodyProps, ctx: ClientContext, store: AnnotationStore, registry: PdfViewRegistry) {
  // Inline bytes are optional; normal reads use the Remote.
  const bytes = props.content && props.content.kind === 'bytes' ? props.content.data : undefined
  const rendererContent = props.content && props.content.kind === 'renderer' ? props.content : undefined
  const address = String(props.resourceAddress ?? '')
  const file = fileNameOf(address)

  const rootRef = useNativeRef()
  const pageHostRef = useNativeRef()
  const panelRef = useNativeRef()
  const [status, setStatus] = useNativeState<Status>({ phase: 'loading' })
  const [flash, setFlash] = useNativeState<string>('')
  const [reload, setReload] = useNativeState(0)

  useEffectImpl(() => {
    let cancelled = false
    let view: { dispose(): void; numPages: number; mode: string } | undefined
    let detachCapture: (() => void) | undefined
    let detachBadges: (() => void) | undefined
    let detachPanel: (() => void) | undefined
    let unregisterView: (() => void) | undefined
    const controller = new AbortController()
    const container = rootRef.current
    const pageHost = pageHostRef.current
    const panelHost = panelRef.current
    if (container === null || pageHost === null || panelHost === null) return undefined
    const ownerSession = readerSessionId(container) || currentSessionId(ctx)

    const notify = (text: string): void => {
      setFlash(text)
      setTimeout(() => { if (!cancelled) setFlash('') }, 2600)
    }
    const actions = {
      showDirect: () => getSharedPreferences()?.getSnapshot().directSubmit === true,
      include: (annotation: Annotation) => !annotation.sessionId || annotation.sessionId === ownerSession,
      onReveal: (annotation: Annotation) => { if (view && 'reveal' in view) void (view as import('./pdf-view').PdfViewImpl).locate(annotation.anchor.quote, annotation.anchor.page).then(found => { if (found) (view as import('./pdf-view').PdfViewImpl).reveal(found.page, found.boxes) }) },
      onSendDraft: async (annotations: readonly Annotation[]): Promise<boolean> => {
        const result = sendToDraft(ctx, ownerSession, buildProtocolBlock(annotations))
        if (result.ok) {
          notify(`已把 ${annotations.length} 条批注加入输入框`)
          return true
        }
        notify(result.reason ?? '加入输入框失败')
        return false
      },
      // The explicit secondary button: always native submit.
      onSendDirect: async (annotations: readonly Annotation[]): Promise<boolean> => {
        const accepted = await sendDirect(ctx, ownerSession, buildProtocolBlock(annotations))
        if (accepted) {
          notify(`已发送 ${annotations.length} 条批注`)
        } else {
          notify('宿主未接受提交；批注已保留，可改用「加入输入框」')
        }
        return accepted
      },
    }

    const mountPanel = () => {
      detachPanel?.(); detachPanel = undefined
      const hasSaved = store.list(address).some(note => !note.sessionId || note.sessionId === ownerSession)
      if (!sidenoteAvailable() || hasSaved) detachPanel = renderAnnotationPanel(panelHost as HTMLElement, store, address, file, actions)
    }
    mountPanel()
    const offPreferences = getSharedPreferences()?.subscribe(mountPanel)

    openDocument(ctx, pageHost as HTMLElement, { address, bytes, sessionId: ownerSession, signal: controller.signal }).then(async (opened) => {
      if (cancelled) { opened.dispose(); return }
      view = opened
      // openPdfView returns before the document resolves. Awaiting it here is
      // what turns a refused read / encrypted / corrupt file into a visible
      // message instead of a reader stuck on "正在打开 PDF…" forever.
      try {
        await opened.ready
      } catch (error) {
        if (!cancelled) {
          opened.dispose()
          // Tell the coordinator too, so the host shows its own retry control
          // alongside this plugin's message rather than a spinner.
          rendererContent?.failed?.()
          setStatus({ phase: 'error', message: describeOpenFailure(error) })
        }
        return
      }
      if (cancelled) {
        opened.dispose()
        rendererContent?.failed?.()
        return
      }
      view = opened
      // loaded() takes the source's opaque version. The host closure already
      // binds its loadRevision and rejects callbacks from replaced views.
      rendererContent?.loaded?.(opened.version ?? 'inline')
      setStatus({ phase: 'ready', pages: view.numPages, mode: view.mode })
      if (opened !== undefined) {
        // Register for citation links: chat replies can drive this view.
        unregisterView = registry.add(address, file, address, opened)
        detachBadges = attachPdfBadges(pageHost as HTMLElement, opened, address, ownerSession)
        detachCapture = attachSelectionCapture(pageHost as HTMLElement, {
          pageAtPoint: (x, y) => opened.pageAtPoint(x, y),
          rectsForSelection: (selection) => opened.rectsForSelection(selection),
        }, {
          onAnnotate: (payload) => {
            const targetSession = readerSessionId(container)
            if (!targetSession) { notify('无法确定当前会话，未添加；请重新打开文件'); return }
            if (captureInSidenote({ sessionId: targetSession, text: payload.quote, source: { label: `${file} · p.${payload.page}`, address, page: payload.page }, point: payload.point })) return
            const id = `pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
            store.add(address, createAnnotation({
              id,
              file,
              sessionId: targetSession,
              sourceAddress: address,
              page: payload.page,
              quote: payload.quote,
              rects: payload.rects,
              createdAt: Date.now(),
            }))
            mountPanel()
            return { update: (note: string) => store.update(address, id, note) }
          },
        })
        return undefined
      }
      return undefined
    }, (error: unknown) => {
      if (!cancelled) { rendererContent?.failed?.(); setStatus({ phase: 'error', message: describeOpenFailure(error) }) }
    })

    return () => {
      cancelled = true
      controller.abort()
      unregisterView?.()
      detachCapture?.()
      detachBadges?.()
      detachPanel?.()
      offPreferences?.()
      view?.dispose()
    }
  }, [bytes, address, rendererContent?.revision, reload])

  return h('div', { ref: rootRef.setter, 'data-paper-margin': file, style: rootStyle },
    h('div', { style: barStyle },
      status.phase === 'ready'
        ? h('span', { style: readyStyle }, `${file} · ${status.pages} 页 · ${status.mode === 'streamed' ? '流式' : '内联'}`)
        : h('span', { style: readyStyle }, status.phase === 'error' ? 'PDF 打开失败' : '正在打开 PDF…'),
      h('button', { type: 'button', onClick: () => { setStatus({ phase: 'loading' }); setReload(reload + 1) } }, '重新加载'),
      flash !== '' ? h('span', { style: flashStyle }, flash) : null),
    status.phase === 'error' ? h('p', { role: 'alert', style: errorStyle }, status.message) : null,
    h('div', { ref: pageHostRef.setter, style: pageHostStyle }),
    h('div', { ref: panelRef.setter, style: panelHostStyle }))
}

/**
 * Open the reader for one Files-tab address.
 *
 * Bytes come from the host's workspace-files Remote, progressively: the reader
 * asks for the ranges pdf.js needs. There is no private HTTP route and no
 * signed URL, so there is no auth step that can fail behind the UI's back.
 */
async function openDocument(
  ctx: ClientContext,
  container: HTMLElement,
  { address, bytes, sessionId, signal }: { address: string; bytes?: Uint8Array; sessionId: string; signal?: AbortSignal },
) {
  const remote = ctx.remote?.workspaceFiles
  const parsed = parseFileAddress(address, sessionId)
  // Diagnostic trail the page can inspect: this is how a silent open failure
  // becomes a number instead of a stuck spinner during verification.
  const diag = (globalThis as { __dshPaperMarginOpen?: unknown[] }).__dshPaperMarginOpen ??= []
  diag.push({ step: 'open', hasRemote: remote !== undefined, address, parsed: parsed?.path, sessionId })
  if (remote !== undefined && parsed !== undefined) {
    try {
      const source = await openWorkspaceSource(remote, parsed.sessionId, parsed.path, signal)
      diag.push({ step: 'source', length: source.length, version: source.version })
      return openPdfView(container, { address, source })
    } catch (error) {
      diag.push({ step: 'source-failed', code: (error as { code?: string })?.code, message: String(error) })
      // A Remote that refuses must not hide a working fallback: when the host
      // already handed us bytes, use them.
      if (bytes === undefined) throw error
    }
  }
  diag.push({ step: 'fallback-inline', hasBytes: bytes !== undefined })
  return openPdfView(container, { address, bytes })
}

/** Split a Files-tab address the way the host's own `parseFileAddress` does.
 *
 * Two details are load-bearing and were wrong before:
 *  - the path is a SLASH-separated sequence (the host normalizes `\` to `/`
 *    when minting the address), so a Windows path must come back with forward
 *    slashes;
 *  - it may be workspace-relative, not absolute — the Remote resolves it
 *    against the session's workspace root.
 * Getting either wrong makes `readBytes` fail for a path the user can see. */

function fileNameOf(address: string): string {
  const clean = String(address ?? '').replace(/[?#].*$/, '')
  const idx = clean.lastIndexOf('/')
  return idx >= 0 ? decodeURIComponent(clean.slice(idx + 1)) : decodeURIComponent(clean)
}

/** Turn a pdf.js open failure into the one sentence the user needs.
 * pdf.js reports a missing/encrypted/corrupt document by error name, and the
 * mint path reports its own refusals; both arrive here as a rejected `ready`. */
function describeOpenFailure(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'PasswordException') return '这个 PDF 有密码保护，暂不支持加密文档。'
  if (name === 'InvalidPDFException') return '这个 PDF 文件已损坏或不是有效的 PDF。'
  if (name === 'MissingPDFException') return '找不到这个文件：它可能已被移动或删除。'
  if (message.includes('403')) return '无权读取该文件：读取授权已失效，请重新打开这个文件。'
  if (message.includes('404')) return '找不到这个文件：它可能已被移动或删除。'
  if (message.includes('授权')) return message
  return `无法打开 PDF：${message}`
}

/** Minimal hook shims over the required react module — no JSX, no imports the
 * module table cannot answer. */
type ReactNamespace = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S) => void]
  useEffect: (fn: () => (() => void) | undefined, deps: unknown[]) => void
}

function react(): ReactNamespace {
  return require('react') as ReactNamespace
}

function useNativeRef(): { current: Element | null; setter: (el: Element | null) => void } {
  const [ref] = react().useState(() => ({ current: null as Element | null, setter: (el: Element | null) => { ref.current = el } }))
  return ref
}

function useNativeState<S>(initial: S): [S, (next: S) => void] {
  return react().useState(initial)
}

function useEffectImpl(fn: () => (() => void) | undefined, deps: unknown[]): void {
  react().useEffect(fn, deps)
}

type CSSStyle = Record<string, string | number>
const rootStyle: CSSStyle = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }
const barStyle: CSSStyle = { flex: '0 0 auto', display: 'flex', gap: 12, alignItems: 'center', padding: '4px 12px' }
const pageHostStyle: CSSStyle = { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }
const panelHostStyle: CSSStyle = { flex: '0 0 auto', maxHeight: '38%', overflow: 'auto' }
const readyStyle: CSSStyle = { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 12 }
const flashStyle: CSSStyle = { color: 'var(--dsw-alias-label-primary, inherit)', fontSize: 12, marginLeft: 'auto' }
const errorStyle: CSSStyle = { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 }
const errorText: CSSStyle = { margin: 0, color: 'var(--dsw-alias-label-primary, inherit)', fontSize: 13 }
const errorHint: CSSStyle = { margin: 0, color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 12 }

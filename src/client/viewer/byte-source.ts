/**
 * Byte access for the reader, through the host's own workspace-files Remote.
 *
 * Why not an HTTP route: a custom route needs a signed URL, a trust fence, and
 * a mint endpoint of its own, and every one of those is a place for the reader
 * to fail silently (a 403 with no visible cause left the preview stuck on
 * "正在打开"). The host already exposes exactly the primitive needed —
 * `remote.workspaceFiles.readBytes(sessionId, path, { range })` — which the
 * built-in preview itself uses. Talking to that Remote is the professional
 * path: no extra route, no key management, and the host's own sandbox policy
 * applies.
 *
 * `pdf.js` reads a document progressively, so the transport feeds it ranges on
 * demand instead of materializing the whole file: a 300MB PDF costs a few
 * small reads, not 300MB of browser memory. This is the same contract pdf.js
 * uses for an HTTP Range source, minus the HTTP.
 */
import * as pdfjs from 'pdfjs-dist'

/** The subset of the host's workspace-files Remote this module calls. */
export interface WorkspaceFilesRemote {
  stat(sessionId: string, path: string, signal?: AbortSignal): Promise<
    | { ok: true; value: { absolutePath?: string; bytes?: number; version?: string } }
    | { ok: false; error: { code: string; message: string } }
  >
  readBytes(
    sessionId: string,
    path: string,
    options: { range?: { offset: number; length: number } },
    signal?: AbortSignal,
  ): Promise<
    | { ok: true; value: { data: Uint8Array; offset: number; bytes?: number; version?: string; eof?: boolean } }
    | { ok: false; error: { code: string; message: string } }
  >
}

/** One file the reader may fetch ranges from. */
export interface ByteSource {
  /** Total byte length, needed by pdf.js before the first range request. */
  readonly length: number
  /** Read an inclusive byte range. Must resolve to the requested bytes. */
  read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>
  /** Observed source version, for cache identity and reload comparison. */
  readonly version: string | undefined
}

/**
 * Build a source over one workspace file.
 * @param remote the host's workspace-files Remote (injected as
 *   `remote.workspaceFiles` in the client plugin).
 * @param options the head bytes the caller already fetched, so opening a PDF
 *   costs one read plus whatever pdf.js asks for afterwards.
 */
export async function openWorkspaceSource(
  remote: WorkspaceFilesRemote,
  sessionId: string,
  path: string,
  signal?: AbortSignal,
  timeoutMs = 20_000,
): Promise<ByteSource> {
  const info = await boundedRead(s => remote.stat(sessionId, path, s), signal, timeoutMs)
  if (!info.ok) throw new RemoteReadFailure(info.error.code, info.error.message)
  const size = info.value.bytes
  if (!Number.isSafeInteger(size) || size === undefined || size < 0) throw new RemoteReadFailure('workspace-file/no-size', '宿主未返回有效的文件大小，无法分块读取')
  if (size === 0) throw new RemoteReadFailure('workspace-file/empty', '这个文件是空的')

  return {
    length: size,
    version: info.value.version,
    async read(offset: number, length: number, readSignal?: AbortSignal): Promise<Uint8Array> {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) throw new RangeError('无效的文件读取区间')
      const clamped = Math.max(0, Math.min(length, size - offset))
      if (clamped === 0) return new Uint8Array(0)
      const result = await boundedRead(s => remote.readBytes(sessionId, path, { range: { offset, length: clamped } }, s), readSignal ?? signal, timeoutMs)
      if (!result.ok) throw new RemoteReadFailure(result.error.code, result.error.message)
      if (result.value.version !== undefined && info.value.version !== undefined && result.value.version !== info.value.version) throw new RemoteReadFailure('workspace-file/changed', '文件已改变，请重新加载预览')
      if (result.value.offset !== offset || result.value.data.length !== clamped) throw new RemoteReadFailure('workspace-file/short-read', '读取的文件分块不完整，请重新打开文件')
      return result.value.data
    },
  }
}

/** Settle even when an older host ignores cancellation or never answers. */
function boundedRead<T>(read: (signal: AbortSignal) => Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    let settled = false
    const finish = (error?: unknown, value?: T) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (error !== undefined) { controller.abort(); reject(error) } else resolve(value as T)
    }
    const abort = () => finish(signal?.reason ?? new DOMException('Preview closed', 'AbortError'))
    const timer = setTimeout(() => finish(new RemoteReadFailure('workspace-file/timeout', '读取文件超时，请重新加载预览')), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try { void read(controller.signal).then(value => finish(undefined, value), error => finish(error)) } catch (error) { finish(error) }
  })
}

/** A read the host refused. Carries the host's code so the UI can explain it. */
export class RemoteReadFailure extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RemoteReadFailure'
    this.code = code
  }
}

/**
 * pdf.js transport backed by a {@link ByteSource}.
 *
 * pdf.js asks for ranges as it parses; each request is answered from the host
 * Remote. Requests are serialized per document (pdf.js can ask for several at
 * once, and the host Remote has a reader budget) and de-duplicated by offset so
 * a re-request during fast scrolling costs nothing.
 */
export class HostRangeTransport extends pdfjs.PDFDataRangeTransport {
  onError?: (error: unknown) => void
  private readonly controller = new AbortController()
  private readonly source: ByteSource
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly queue: Array<{ run(): void; cancel(): void }> = []
  private active = 0
  private disposed = false

  constructor(source: ByteSource, initialData?: Uint8Array) {
    super(source.length, initialData ?? null)
    this.source = source
  }

  /**
   * pdf.js calls this once per requested range. Answering is asynchronous:
   * `onDataRange` publishes the bytes back into the document.
   */
  requestDataRange(begin: number, end: number): void {
    if (this.disposed) return
    const key = `${begin}:${end}`
    const existing = this.inflight.get(key)
    if (existing !== undefined) return
    const job = this.drain(async () => {
      if (this.disposed) return
      try {
        const chunk = await this.source.read(begin, end - begin, this.controller.signal)
        if (!this.disposed) this.onDataRange(begin, chunk)
      } catch (error) {
        // The owner destroys the loading task on error. Empty data would
        // violate pdf.js's range contract and leave the request pending.
        if (!this.disposed) this.onError?.(error)
      }
    })
    this.inflight.set(key, job)
    void job.finally(() => { this.inflight.delete(key) })
  }

  /** Bound concurrency: a fast scroll can queue dozens of ranges. */
  private drain(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      const run = (): void => {
        this.active += 1
        void task().finally(() => {
          this.active -= 1
          const next = this.queue.shift()
          if (next !== undefined) next.run()
          resolve()
        })
      }
      if (this.active < 4) run()
      else this.queue.push({ run, cancel: resolve })
    })
  }

  dispose(): void {
    this.disposed = true
    this.controller.abort()
    for (const job of this.queue.splice(0)) job.cancel()
    this.inflight.clear()
  }

  override abort(): void { this.dispose() }
}

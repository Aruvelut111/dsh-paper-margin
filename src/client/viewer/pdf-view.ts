/**
 * pdf.js view: pages rendered in a virtualized stack with the text layer on
 * top so text can be selected.
 *
 * Adapted from two validated implementations, with their non-negotiables kept:
 *  - one long-lived PDFWorker per page (cite-lens: a worker handed via
 *    getDocument({ worker }) is never destroyed by pdf.js, which avoids
 *    "PDFWorker.create - the worker is being destroyed" on view swap);
 *  - page positions from page sizes, never measured per scroll event;
 *  - render only pages near the viewport; free distant pages.
 *
 * The document reads requested byte ranges through the host Remote.
 * Inline bytes remain available for callers that already own a complete buffer.
 */
import * as pdfjs from 'pdfjs-dist'
import { boxesFor, findInItems, searchOrder, type FractionBox, type TextItem } from '../protocol/textsearch'
import { HostRangeTransport, type ByteSource } from './byte-source'
import { readerControls } from './controls'
import { pacedTextStream } from './text-stream'

/** undefined: not created yet; null: no worker (tests fall back to fake worker). */
let sharedWorker: pdfjs.PDFWorker | null | undefined
function getWorker(): pdfjs.PDFWorker | null {
  if (sharedWorker !== undefined) return sharedWorker
  const source = typeof __DSH_PAPER_MARGIN_WORKER__ === 'string' ? __DSH_PAPER_MARGIN_WORKER__ : null
  if (source === null) {
    sharedWorker = null
    return sharedWorker
  }
  // One blob URL per page lifetime, shared by every document: the worker must
  // keep its source resolvable for as long as it lives, so the URL is
  // deliberately not revoked (a page reload reclaims it with the document).
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const port = new Worker(url, { type: 'module', name: 'dsh-paper-margin' })
  // pdfjs 4.10's PDFWorker constructor types `port` as null-only (a types bug
  // against its own PDFWorkerParameters alias); at runtime it takes a Worker.
  const worker = new pdfjs.PDFWorker({ port: port as unknown as null, name: 'dsh-paper-margin' as unknown as null })
  sharedWorker = worker
  return worker
}

const GAP = 14
const KEEP = 1
const MAX_CANVAS_PIXELS = 4_194_304

export function openPdfView(
  container: HTMLElement,
  options: { address?: string; bytes?: Uint8Array; source?: ByteSource },
): PdfViewImpl {
  return new PdfViewImpl(container, options)
}

export class PdfViewImpl {
  container: HTMLElement
  address: string
  disposed = false
  pages: (HTMLDivElement | null)[]
  numPages = 0
  mode: 'streamed' | 'inline' = 'streamed'
  frame = 0
  queue: number[] = []
  active: number | null = null
  scroller: HTMLDivElement
  stack: HTMLDivElement
  onScroll: () => void
  ready: Promise<void>
  doc?: pdfjs.PDFDocumentProxy
  transport?: HostRangeTransport
  version?: string
  task?: pdfjs.PDFDocumentLoadingTask
  private resizeObserver?: ResizeObserver
  private controls: ReturnType<typeof readerControls>
  private zoomFactor = 1
  private generation = 0
  private readonly pendingFlashes = new Map<number, readonly FractionBox[]>()
  private readonly renders = new Set<pdfjs.RenderTask>()
  private readonly textLayers = new Map<number, pdfjs.TextLayer>()
  private dragging = false
  private resumeFrame = 0
  private readonly continuations = new Set<() => void>()
  private readonly pointerDown = () => { this.dragging = true }
  private readonly pointerUp = () => {
    this.dragging = false
    if (this.resumeFrame) return
    this.resumeFrame = requestAnimationFrame(() => {
      this.resumeFrame = 0
      for (const resume of this.continuations) resume()
      this.continuations.clear()
      this.pump()
    })
  }
  tops: number[] = []
  sizes: ({ w: number; h: number } | null)[] = []
  scale = 1
  totalHeight = 0
  baseWidth = 0
  baseHeight = 0
  textCache?: Map<number, { items: TextItem[]; viewport: { width: number; height: number; convertToViewportPoint(x: number, y: number): [number, number] } }>

  constructor(container: HTMLElement, { address, bytes, source }: { address?: string; bytes?: Uint8Array; source?: ByteSource }) {
    this.container = container
    this.address = address ?? ''
    this.disposed = false
    this.pages = []
    this.numPages = 0
    this.mode = 'streamed'
    this.frame = 0
    this.queue = []
    this.active = null

    this.scroller = document.createElement('div')
    this.scroller.setAttribute('data-paper-margin-scroll', '')
    Object.assign(this.scroller.style, { overflow: 'auto', flex: '1 1 auto', minHeight: 0, background: 'var(--dsw-alias-bg-document-preview, transparent)', padding: '16px 0' })
    this.stack = document.createElement('div')
    Object.assign(this.stack.style, { position: 'relative', width: 'fit-content', margin: '0 auto' })
    this.scroller.appendChild(this.stack)
    container.appendChild(this.scroller)
    this.controls = readerControls(this)
    container.prepend(this.controls.node)

    this.onScroll = () => {
      if (this.frame) return
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        this.schedule()
      })
    }
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true })
    this.scroller.addEventListener('pointerdown', this.pointerDown, { passive: true })
    window.addEventListener('pointerup', this.pointerUp)
    window.addEventListener('pointercancel', this.pointerUp)
    window.addEventListener('blur', this.pointerUp)

    this.ready = this.load({ bytes, source })
    this.ready.catch(() => undefined)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.doc || this.disposed) return
        const width = this.scroller.clientWidth
        const next = Math.max(0.2, Math.min(4, (width - 32) / this.baseWidth * this.zoomFactor))
        if (width > 40 && Math.abs(next - this.scale) > 0.02) void this.layout().catch(() => undefined)
      })
      this.resizeObserver.observe(container)
    }
  }

  async load({ bytes, source }: { bytes?: Uint8Array; source?: ByteSource }): Promise<void> {
    const worker = getWorker()
    const baseOptions = {
      isEvalSupported: false,
      enableXfa: false,
      ...(worker ? { worker } : {}),
    }
    let task: pdfjs.PDFDocumentLoadingTask
    if (source !== undefined) {
      // Progressive, range-backed open: pdf.js asks this transport for the
      // bytes it needs, page by page. Nothing is materialized up front.
      this.mode = 'streamed'
      this.version = source.version
      const transport = new HostRangeTransport(source)
      this.transport = transport
      task = pdfjs.getDocument({ range: transport, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144, ...baseOptions })
      transport.onError = (error) => { this.showFailure(error); void task.destroy() }
    } else if (bytes !== undefined) {
      this.mode = 'inline'
      // pdf.js transfers the buffer; copy so the tab's own bytes stay usable.
      task = pdfjs.getDocument({ data: bytes.slice(), ...baseOptions })
    } else {
      throw new Error('没有可用的文件字节来源')
    }
    this.task = task
    const loaded = await task.promise
    if (this.disposed) { await loaded.destroy(); return }
    this.doc = loaded
    this.numPages = this.doc.numPages
    this.pages = new Array(this.numPages).fill(null)
    this.tops = new Array(this.numPages).fill(0)
    this.sizes = new Array(this.numPages).fill(null)
    await this.layout()
  }

  /** Compute page offsets from page sizes once, then only on zoom change. */
  async layout(): Promise<void> {
    const generation = ++this.generation
    const readingPage = this.currentPage()
    for (const render of this.renders) render.cancel()
    for (const layer of this.textLayers.values()) layer.cancel()
    this.textLayers.clear()
    for (const slot of this.pages) slot?.remove()
    this.pages.fill(null)
    let offset = 0
    const first = await this.doc!.getPage(1)
    if (this.disposed || generation !== this.generation) return
    const base = first.getViewport({ scale: 1 })
    this.baseWidth = base.width
    this.baseHeight = base.height
    this.scale = Math.max(0.2, Math.min(4, (this.scroller.clientWidth - 32) / base.width * this.zoomFactor))
    for (let i = 0; i < this.numPages; i++) {
      this.tops[i] = offset
      offset += base.height * this.scale + GAP
      this.sizes[i] = { w: base.width * this.scale, h: base.height * this.scale }
    }
    this.totalHeight = offset
    Object.assign(this.stack.style, { height: `${this.totalHeight}px`, width: `${base.width * this.scale}px` })
    this.scroller.scrollTop = this.topOf(readingPage)
    this.controls.refresh()
    if (!this.disposed) this.schedule()
  }

  /** Absolute document y of a page top. */
  topOf(n: number): number {
    return this.tops[n - 1] ?? 0
  }

  currentPage(): number { return Math.max(1, this.pageAt(this.scroller.scrollTop + 20)) }
  zoom(factor: number): void { this.zoomFactor = factor; void this.layout().catch(error => this.showFailure(error)) }

  /** Find quoted words: hinted page first, then neighbours, then the rest.
   * Works on pdf.js text content, so undrawn pages count. */
  async locate(quote: string, hint?: number, pageOnly = false): Promise<{ page: number; boxes: FractionBox[] } | null> {
    if (this.doc === undefined || quote === '') return null
    this.textCache ??= new Map()
    for (const n of (pageOnly && hint ? [hint] : searchOrder(this.numPages, hint).slice(0, 32))) {
      if (this.disposed) return null
      let entry = this.textCache.get(n)
      if (entry === undefined) {
        const page = await this.doc.getPage(n)
        const { items } = await page.getTextContent()
        const viewport = page.getViewport({ scale: 1 })
        entry = {
          items: items as unknown as TextItem[],
          viewport: {
            width: viewport.width,
            height: viewport.height,
            convertToViewportPoint: (x: number, y: number): [number, number] => {
              const pair = viewport.convertToViewportPoint(x, y) as number[]
              return [pair[0] ?? 0, pair[1] ?? 0]
            },
          },
        }
        this.textCache.set(n, entry)
        if (this.textCache.size > 12) this.textCache.delete(this.textCache.keys().next().value!)
      }
      const spans = findInItems(entry.items, quote)
      if (spans !== null) return { page: n, boxes: boxesFor(spans, entry.items, entry.viewport) }
    }
    return null
  }

  /** Scroll a passage into view (about a third down the screen) and flash it. */
  reveal(n: number, boxes: readonly FractionBox[] = []): void {
    if (this.disposed) return
    const size = this.sizes[n - 1]
    if (size === undefined || size === null) return
    if (boxes.length > 0) {
      const top = Math.min(...boxes.map((b) => b.y))
      const target = this.topOf(n) + top * size.h - this.scroller.clientHeight * 0.3
      this.scroller.scrollTop = Math.max(0, target)
      this.schedule()
    } else {
      this.scroller.scrollTop = Math.max(0, this.topOf(n) - 8)
      this.schedule()
    }
    this.flash(n, boxes)
  }

  /** Briefly mark a page, and the passage on it (page-relative fractions). */
  flash(n: number, boxes: readonly FractionBox[] = []): void {
    const slot = this.pages[n - 1]
    if (slot === null || slot === undefined) { this.pendingFlashes.set(n, boxes); return }
    this.pendingFlashes.delete(n)
    slot.classList.remove('pm-flash')
    void slot.offsetWidth
    slot.classList.add('pm-flash')
    for (const box of boxes) {
      const mark = document.createElement('div')
      mark.setAttribute('data-paper-margin-mark', '')
      Object.assign(mark.style, {
        position: 'absolute',
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        background: 'rgba(47, 136, 255, .25)',
        outline: '1.5px solid rgba(230, 160, 0, .8)',
        borderRadius: '2px',
        pointerEvents: 'none',
      } as CSSStyleDeclaration)
      slot.appendChild(mark)
      setTimeout(() => { mark.remove() }, 3400)
    }
    setTimeout(() => { slot.classList.remove('pm-flash') }, 1600)
  }

  schedule() {
    if (this.disposed) return
    this.controls.refresh()
    const scrollTop = this.scroller.scrollTop
    const viewTop = scrollTop
    const viewBottom = scrollTop + this.scroller.clientHeight
    const current = this.pageAt(viewTop + (viewBottom - viewTop) / 2)
    const wanted: number[] = []
    const first = Math.max(1, this.pageAt(viewTop) - KEEP)
    const last = Math.min(this.numPages, this.pageAt(viewBottom) + KEEP)
    for (let p = first; p <= last; p++) if (this.pages[p - 1] === null) wanted.push(p)
    wanted.sort((a, b) => Math.abs(a - current) - Math.abs(b - current))
    this.queue = wanted
    this.freeDistant()
    this.pump()
  }

  pageAt(y: number): number {
    if (this.totalHeight === 0 || this.numPages === 0) return 1
    let low = 0; let high = this.numPages - 1
    while (low <= high) {
      const middle = (low + high) >>> 1
      if (this.tops[middle]! <= y) low = middle + 1
      else high = middle - 1
    }
    return Math.max(1, Math.min(this.numPages, high + 1))
  }

  /** Page number under a viewport point, for the selection toolbar. */
  pageAtPoint(x: number, y: number): number | null {
    const stackRect = this.stack.getBoundingClientRect()
    if (x < stackRect.left || x > stackRect.right) return null
    const page = this.pageAt(y - stackRect.top)
    return page >= 1 && page <= this.numPages ? page : null
  }

  /** Selection rects in page-stack coordinates (page, y already absolute). */
  rectsForSelection(selection: Selection): { x: number; y: number; w: number; h: number }[] {
    const stackRect = this.stack.getBoundingClientRect()
    const out: { x: number; y: number; w: number; h: number }[] = []
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i)
      const rects = range.getClientRects()
      for (let r = 0; r < rects.length; r++) {
        const rect = rects[r]!
        if (rect.width === 0 || rect.height === 0) continue
        out.push({
          x: rect.left - stackRect.left,
          y: rect.top - stackRect.top,
          w: rect.width,
          h: rect.height,
        })
      }
    }
    return out
  }

  pump() {
    if (this.active !== null || this.disposed || this.dragging) return
    const page = this.queue.shift()
    if (page === undefined) return
    this.active = page
    this.renderPage(page).catch(error => { if (!this.disposed && error?.name !== 'RenderingCancelledException') this.showFailure(error) }).finally(() => {
      this.active = null
      if (!this.disposed) this.pump()
    })
  }

  async renderPage(number: number): Promise<void> {
    const generation = this.generation
    if (this.disposed || this.pages[number - 1] !== null) return
    const size = this.sizes[number - 1]
    if (size === undefined || size === null) return
    const page = await this.doc!.getPage(number)
    if (this.disposed || generation !== this.generation) return
    const viewport = page.getViewport({ scale: this.scale })
    if (Math.abs(size.w - viewport.width) > 1 || Math.abs(size.h - viewport.height) > 1) {
      size.w = viewport.width; size.h = viewport.height
      let offset = 0
      for (let i = 0; i < this.numPages; i++) {
        this.tops[i] = offset
        if (this.pages[i]) this.pages[i]!.style.top = `${offset}px`
        offset += (this.sizes[i]?.h ?? this.baseHeight * this.scale) + GAP
      }
      this.totalHeight = offset
      this.stack.style.height = `${offset}px`
      this.stack.style.width = `${Math.max(...this.sizes.map(s => s?.w ?? 0))}px`
    }
    // Keep the text layer at CSS scale; cap only the raster backing store.
    const rasterScale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)))
    const raster = page.getViewport({ scale: this.scale * rasterScale })
    const slot = document.createElement('div')
    slot.setAttribute('data-paper-margin-page', String(number))
    Object.assign(slot.style, {
      position: 'absolute',
      top: `${this.tops[number - 1]}px`,
      left: '0',
      width: `${size.w}px`,
      height: `${size.h}px`,
      background: 'white',
      boxShadow: '0 0 4px rgba(0,0,0,.15)',
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(raster.width)
    canvas.height = Math.ceil(raster.height)
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' })
    slot.appendChild(canvas)
    this.stack.appendChild(slot)
    this.pages[number - 1] = slot
    const pendingFlash = this.pendingFlashes.get(number)
    if (pendingFlash !== undefined) this.flash(number, pendingFlash)
    const context = canvas.getContext('2d')
    if (context === null) return
    const render = page.render({ canvasContext: context, viewport: raster }); this.renders.add(render)
    // PDF.js exposes the same cooperative pause used by its native viewer.
    // Do not spend the next canvas slice while the user is dragging a range.
    render.onContinue = (resume: () => void) => {
      if (this.dragging) this.continuations.add(resume)
      else requestAnimationFrame(() => {
        if (this.disposed) return
        if (this.dragging) this.continuations.add(resume)
        else resume()
      })
    }
    try { await render.promise } finally { this.renders.delete(render) }
    if (this.disposed) return
    // Text layer after the image, in idle time (cite-lens discipline).
    await new Promise<void>(resolve => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 250 })
      else setTimeout(resolve, 16)
    })
    if (this.dragging) await new Promise<void>(resolve => { this.continuations.add(resolve) })
    if (!this.disposed) {
      if (this.disposed || this.pages[number - 1] !== slot) return
      const textContent = pacedTextStream(page.streamTextContent(), () => this.dragging, () => this.disposed || this.pages[number - 1] !== slot)
      if (this.disposed || this.pages[number - 1] !== slot) return
      // pdf.js builds selectable spans inside a *dedicated* .textLayer div that
      // sits absolutely over the canvas. Handing it the page element directly
      // scatters the spans into the page box, where the .textLayer CSS rules
      // never reach them and nothing can be selected — the reason selection
      // produced no toolbar.
      const textLayerDiv = document.createElement('div')
      textLayerDiv.className = 'textLayer'
      textLayerDiv.style.setProperty('--scale-factor', String(this.scale))
      textLayerDiv.style.setProperty('--total-scale-factor', String(this.scale))
      slot.appendChild(textLayerDiv)
      const layer = new pdfjs.TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport })
      this.textLayers.set(number, layer)
      try { await layer.render() } catch (error) {
        if (this.disposed || generation !== this.generation || this.pages[number - 1] !== slot) return
        throw error
      } finally { if (this.textLayers.get(number) === layer) this.textLayers.delete(number) }
      if (this.disposed || this.pages[number - 1] !== slot) {
        textLayerDiv.remove()
        return
      }
      slot.setAttribute('data-paper-margin-text', '')
    }
    this.freeDistant()
  }

  freeDistant(): void {
    if (this.dragging) return
    const first = Math.max(1, this.pageAt(this.scroller.scrollTop) - KEEP - 1)
    const last = Math.min(this.numPages, this.pageAt(this.scroller.scrollTop + this.scroller.clientHeight) + KEEP + 1)
    for (let p = 1; p <= this.numPages; p++) {
      if (p >= first && p <= last) continue
      const slot = this.pages[p - 1]
      if (slot !== null && slot !== undefined) {
        if (p === this.active) for (const render of this.renders) render.cancel()
        this.textLayers.get(p)?.cancel(); this.textLayers.delete(p)
        for (const canvas of slot.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0 }
        slot.remove()
        this.pages[p - 1] = null
        void this.doc?.getPage(p).then(page => { if (this.pages[p - 1] === null) page.cleanup() }).catch(() => undefined)
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.resizeObserver?.disconnect()
    this.controls.dispose()
    for (const render of this.renders) render.cancel()
    for (const layer of this.textLayers.values()) layer.cancel()
    this.textLayers.clear()
    for (const resume of this.continuations) resume()
    this.continuations.clear()
    if (this.resumeFrame) cancelAnimationFrame(this.resumeFrame)
    if (this.frame) cancelAnimationFrame(this.frame)
    this.transport?.dispose()
    this.scroller.removeEventListener('scroll', this.onScroll)
    this.scroller.removeEventListener('pointerdown', this.pointerDown)
    window.removeEventListener('pointerup', this.pointerUp)
    window.removeEventListener('pointercancel', this.pointerUp)
    window.removeEventListener('blur', this.pointerUp)
    void this.task?.destroy().catch(() => undefined)
    this.scroller.remove()
  }

  private showFailure(error: unknown): void {
    if (this.disposed) return
    let notice = this.container.querySelector<HTMLElement>('[data-paper-margin-read-error]')
    if (!notice) { notice = document.createElement('p'); notice.dataset.paperMarginReadError = ''; notice.setAttribute('role', 'alert'); this.container.prepend(notice) }
    notice.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}。请重新加载预览。`
  }
}

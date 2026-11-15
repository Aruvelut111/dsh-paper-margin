import { randomUUID } from 'node:crypto'
import type { NativePage, PageCommand, PageOutcome, PageRead, SidebarResource } from '../browser-contract'
import { pageFailure } from '../browser-contract'

interface Client {
  pages: NativePage[]
  resources: SidebarResource[]
  seen: number
  waiter?: { resolve(commands: PageCommand[]): void }
}
interface Pending {
  clientId: string
  page: NativePage
  command: PageCommand
  resolve(outcome: PageOutcome): void
}
/** Adapted to a read-only, session-bound scope from the MIT native-browser bridges. */
export class NativePageBridge {
  private clients = new Map<string, Client>()
  private pending = new Map<string, Pending>()
  private queued = new Set<string>()
  private disposed = false
  list(sessionId: string): NativePage[] {
    this.prune()
    return [...this.clients.values()].flatMap(client => client.pages.filter(page => page.sessionId === sessionId))
  }
  resources(sessionId: string): (SidebarResource & { windowId: string })[] {
    this.prune()
    return [...this.clients].flatMap(([windowId, client]) => client.resources
      .filter(item => item.sessionId === sessionId).map(item => ({ ...item, windowId })))
  }
  private prune(): void {
    for (const [id, client] of this.clients) if (Date.now() - client.seen > 45_000) {
      client.waiter?.resolve([])
      this.clients.delete(id)
      for (const pending of [...this.pending.values()]) if (pending.clientId === id) pending.resolve(pageFailure('CLIENT_DISCONNECTED', 'The DSH window is no longer connected.'))
    }
  }
  poll(clientId: string, pages: NativePage[], signal: AbortSignal, resources: SidebarResource[] = []): Promise<PageCommand[]> {
    if (this.disposed || signal.aborted) return Promise.resolve([])
    this.prune()
    const previous = this.clients.get(clientId)
    previous?.waiter?.resolve([])
    if (!previous && this.clients.size >= 16) throw new Error('Too many page-reader windows')
    const client: Client = { pages, resources, seen: Date.now() }
    this.clients.set(clientId, client)
    for (const pending of [...this.pending.values()]) if (pending.clientId === clientId
      && !pages.some(page => page.id === pending.page.id && page.sessionId === pending.page.sessionId && page.url === pending.page.url)) {
      pending.resolve(pageFailure('PAGE_CHANGED', 'The original page is closed, has navigated, or changed conversation.'))
    }
    return new Promise(resolve => {
      let done = false
      const finish = (commands: PageCommand[]) => {
        if (done) return
        done = true; clearTimeout(timer); signal.removeEventListener('abort', aborted)
        if (client.waiter?.resolve === finish) client.waiter = undefined
        resolve(commands)
      }
      const aborted = () => finish([])
      const timer = setTimeout(() => finish([]), 20_000)
      client.waiter = { resolve: finish }
      signal.addEventListener('abort', aborted, { once: true })
      this.deliver(clientId)
    })
  }
  private deliver(clientId: string): void {
    const client = this.clients.get(clientId)
    if (!client?.waiter) return
    const commands = [...this.queued].flatMap(id => {
      const entry = this.pending.get(id)
      if (!entry || entry.clientId !== clientId) return []
      this.queued.delete(id)
      return [entry.command]
    })
    if (commands.length) client.waiter.resolve(commands)
  }
  read(sessionId: string, request: PageRead, signal?: AbortSignal): Promise<PageOutcome> {
    if (this.disposed || signal?.aborted) return Promise.resolve(pageFailure('CANCELLED', 'The page read was cancelled.'))
    this.prune()
    const target = [...this.clients].find(([, client]) => client.pages.some(page => page.sessionId === sessionId && page.id === request.pageId && page.url === request.expectedUrl))
    if (!target) return Promise.resolve(pageFailure('PAGE_NOT_FOUND', 'No matching native page belongs to this conversation. List pages; do not substitute another page or URL.'))
    if (this.pending.size >= 32) return Promise.resolve(pageFailure('BUSY', 'Too many page reads are pending.'))
    const [clientId, client] = target
    const page = client.pages.find(page => page.id === request.pageId)!
    const id = randomUUID()
    return new Promise(resolve => {
      const finish = (outcome: PageOutcome) => {
        if (!this.pending.delete(id)) return
        this.queued.delete(id); clearTimeout(timer); signal?.removeEventListener('abort', aborted)
        resolve(outcome)
      }
      const aborted = () => finish(pageFailure('CANCELLED', 'The page read was cancelled.'))
      const timer = setTimeout(() => finish(pageFailure('PAGE_TIMEOUT', 'The DSH page reader did not answer in time.')), 12_000)
      this.pending.set(id, { clientId, page, command: { id, sessionId, request }, resolve: finish })
      this.queued.add(id)
      signal?.addEventListener('abort', aborted, { once: true })
      this.deliver(clientId)
    })
  }
  result(clientId: string, id: string, outcome: PageOutcome): boolean {
    const pending = this.pending.get(id)
    if (!pending || pending.clientId !== clientId) return false
    if (outcome.ok && (outcome.value.pageId !== pending.page.id || outcome.value.url !== pending.page.url)) {
      pending.resolve(pageFailure('PAGE_CHANGED', 'The page response did not match the original source.'))
    } else pending.resolve(outcome)
    return true
  }
  dispose(): void {
    this.disposed = true
    for (const pending of [...this.pending.values()]) pending.resolve(pageFailure('CANCELLED', 'The page reader was unloaded.'))
    for (const client of this.clients.values()) client.waiter?.resolve([])
    this.clients.clear()
  }
}


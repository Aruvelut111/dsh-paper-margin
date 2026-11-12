/**
 * Registry of live PDF views: name → view, so citations in chat can find and
 * drive the reader. One instance per client root; views register on open and
 * unregister on dispose.
 */
import type { PdfViewImpl } from './pdf-view'

export interface RegistryEntry {
  key: string
  file: string
  address: string
  view: PdfViewImpl
  openedAt: number
}

export class PdfViewRegistry {
  private readonly entries = new Map<string, RegistryEntry>()
  private lastKey: string | undefined
  private readonly waiters = new Map<string, Array<(entry: RegistryEntry | undefined) => void>>()

  add(key: string, file: string, address: string, view: PdfViewImpl): () => void {
    const openedAt = Date.now()
    const entry = { key, file, address, view, openedAt }
    this.entries.set(key, entry)
    this.lastKey = key
    for (const [wanted, waiters] of this.waiters) {
      const found = this.find(wanted)
      if (found) { for (const waiter of waiters) waiter(found); this.waiters.delete(wanted) }
    }
    // Unregister only if this exact registration is still the live one: a newer
    // view for the same key must survive an older one's teardown.
    return () => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      if (this.lastKey === key && this.entries.get(key) === undefined) this.lastKey = undefined
    }
  }

  find(fileOrName: string): RegistryEntry | undefined {
    const wanted = normalize(fileOrName)
    let matches = [...this.entries.values()].filter(entry => normalize(entry.address) === wanted || normalize(entry.file) === wanted || normalize(entry.address).endsWith('/' + wanted))
    if (matches.length <= 1) return matches[0]
    const session = this.currentSessionId()
    if (session) matches = matches.filter(entry => entry.address.includes('/session/' + encodeURIComponent(session) + '/'))
    return matches.length === 1 ? matches[0] : undefined
  }

  latest(): RegistryEntry | undefined {
    if (this.lastKey !== undefined) {
      const entry = this.entries.get(this.lastKey)
      if (entry !== undefined) return entry
    }
    let best: RegistryEntry | undefined
    for (const entry of this.entries.values()) {
      if (best === undefined || entry.openedAt > best.openedAt) best = entry
    }
    return best
  }

  lastOpened(): RegistryEntry | undefined {
    return this.latest()
  }

  get size(): number {
    return this.entries.size
  }

  /** Workspace-relative address for a cited file path, resolved against the
   * current chat; undefined when it cannot be built. */
  addressFor(file: string): string | undefined {
    const sessionId = this.currentSessionId?.()
    if (sessionId === undefined || sessionId === '') return undefined
    return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${file.split('/').map(encodeURIComponent).join('/')}`
  }

  currentSessionId: () => string | undefined = () => undefined

  waitFor(file: string, timeoutMs = 6000): Promise<RegistryEntry | undefined> {
    const existing = this.find(file)
    if (existing !== undefined) return Promise.resolve(existing)
    const wanted = normalize(file)
    return new Promise((resolveWait) => {
      // One resolver per waiter, so the timeout can remove exactly its own.
      const resolver = (entry: RegistryEntry | undefined): void => {
        clearTimeout(timer)
        resolveWait(entry)
      }
      const timer = setTimeout(() => {
        const queueNow = this.waiters.get(wanted) ?? []
        const at = queueNow.indexOf(resolver)
        if (at >= 0) queueNow.splice(at, 1)
        if (queueNow.length === 0) this.waiters.delete(wanted)
        resolveWait(undefined)
      }, timeoutMs)
      const queue = this.waiters.get(wanted) ?? []
      queue.push(resolver)
      this.waiters.set(wanted, queue)
    })
  }
}

function normalize(value: string): string {
  let decoded = String(value ?? '')
  try { decoded = decodeURIComponent(decoded) } catch { /* malformed legacy citation */ }
  return decoded.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase()
}

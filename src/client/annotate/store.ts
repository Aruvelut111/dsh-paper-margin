/**
 * Annotation store: localStorage-backed, per Files-tab address, observable.
 *
 * sidenote's persistence discipline: versioned key, tolerant revive, empty
 * lists delete their key, and a getSnapshot/subscribe face so panels re-render
 * without a framework.
 */
import type { Annotation } from '../../contract'
import { reviveStore, upsertAnnotation, markSent, type AnnotationStoreShape } from './model'

export interface AnnotationStore {
  addresses(): readonly string[]
  persistenceError?(): string | undefined
  list(address: string): readonly Annotation[]
  add(address: string, annotation: Annotation): void
  update(address: string, id: string, note: string): void
  remove(address: string, id: string): void
  clearSent(address: string): void
  markSent(address: string, ids: readonly string[]): void
  getSnapshot(): number
  subscribe(fn: () => void): () => void
}

const KEY_PREFIX = 'dsh-paper-margin:store:v1:'

export function createAnnotationStore(storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): AnnotationStore {
  const listeners = new Set<() => void>()
  let version = 0
  const cache = new Map<string, AnnotationStoreShape>()
  let persistenceError: string | undefined

  const read = (address: string): AnnotationStoreShape => {
    if (cache.has(address)) return cache.get(address)!
    let raw: string | null = null
    try { raw = storage?.getItem(KEY_PREFIX + address) ?? null } catch { persistenceError = '本地存储不可用，当前批注仅保留在本窗口，请及时复制。' }
    const shape = reviveStore(raw); cache.set(address, shape); return shape
  }

  const write = (address: string, shape: AnnotationStoreShape): void => {
    cache.set(address, shape)
    try {
      if (shape.annotations.length === 0) storage?.removeItem(KEY_PREFIX + address)
      else storage?.setItem(KEY_PREFIX + address, JSON.stringify(shape))
    } catch { persistenceError = '批注未能持久保存（空间不足或存储受限），请复制备份。' }
    version += 1
    for (const listener of listeners) listener()
  }

  return {
    addresses: () => {
      const keys = new Set(cache.keys())
      try { for (let i = 0; i < (storage?.length ?? 0); i++) { const key = storage?.key(i); if (key?.startsWith(KEY_PREFIX)) keys.add(key.slice(KEY_PREFIX.length)) } } catch { /* cached notes stay usable */ }
      return [...keys].filter(key => read(key).annotations.length > 0)
    },
    persistenceError: () => persistenceError,
    list: (address) => read(address).annotations,
    add: (address, annotation) => {
      const shape = read(address)
      write(address, { version: shape.version, annotations: upsertAnnotation(shape.annotations, annotation) })
    },
    update: (address, id, note) => {
      const shape = read(address)
      const existing = shape.annotations.find((a) => a.id === id)
      if (existing === undefined) return
      write(address, {
        version: shape.version,
        annotations: upsertAnnotation(shape.annotations, { ...existing, note, state: 'active' }),
      })
    },
    remove: (address, id) => {
      const shape = read(address)
      write(address, { version: shape.version, annotations: shape.annotations.filter((a) => a.id !== id) })
    },
    clearSent: (address) => {
      const shape = read(address)
      write(address, { version: shape.version, annotations: shape.annotations.filter((a) => a.state !== 'sent') })
    },
    markSent: (address, ids) => {
      const shape = read(address)
      write(address, { version: shape.version, annotations: markSent(shape.annotations, ids) })
    },
    getSnapshot: () => version,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

/** One store per client root. Module-level singleton: a cordis client ctx is a
 * guarded proxy that rejects arbitrary property writes ("cannot set property
 * … without provide"), so the store cannot ride on ctx. */
let sharedStore: AnnotationStore | undefined

export function provideStore(_ctx?: unknown): AnnotationStore {
  if (sharedStore === undefined) sharedStore = createAnnotationStore()
  return sharedStore
}

/** Test seam: drop the singleton so each test starts from an empty store. */
export function resetStoreForTests(): void {
  sharedStore = undefined
}

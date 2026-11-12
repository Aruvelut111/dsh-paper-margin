/**
 * Client preferences over the host config form: observable snapshot + set,
 * sidenote's validated shape. One form instance per client root.
 */
export interface MarginConfigForm {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: { directSubmit?: boolean } | undefined
    writable: boolean
  }
  subscribe(fn: () => void): () => void
  set(field: 'directSubmit', value: boolean): Promise<boolean>
}

export interface MarginPreferences {
  getSnapshot(): {
    directSubmit: boolean
    status: 'loading' | 'ready' | 'unavailable'
    writable: boolean
    saving: boolean
    failed: boolean
  }
  subscribe(fn: () => void): () => void
  setDirectSubmit(value: boolean): Promise<void>
  dispose(): void
}

export function createMarginPreferences(form: MarginConfigForm): MarginPreferences {
  const listeners = new Set<() => void>()
  let saving = false
  let failed = false
  const read = () => {
    const state = form.getSnapshot()
    return {
      directSubmit: state.value?.directSubmit ?? false,
      status: state.status,
      writable: state.writable,
      saving,
      failed,
    }
  }
  let snapshot = read()
  const publish = (): void => {
    snapshot = read()
    for (const listener of listeners) listener()
  }
  const unsubscribe = form.subscribe(publish)
  const set = async (value: boolean): Promise<void> => {
    if (saving || snapshot.status !== 'ready' || !snapshot.writable) return
    saving = true
    failed = false
    publish()
    try {
      failed = !(await form.set('directSubmit', value))
    } catch {
      failed = true
    } finally {
      saving = false
      publish()
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setDirectSubmit: value => set(value),
    dispose() {
      unsubscribe()
      listeners.clear()
    },
  }
}

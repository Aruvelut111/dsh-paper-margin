import { BROWSER_ROUTE, type PageCommand } from '../../browser-contract'
import { observeReaderRoots, observeReaderVisibility } from '../annotate/reader-surface'
import { executePageRead, nativePages, nativePageNavigated, PAGE_SELECTOR } from './pages'

/** One idle long-poll; metadata only. Guest text is read solely for a tool command. */
export function attachNativePageReader(fetcher: typeof fetch = fetch): () => void {
  const clientId = crypto.randomUUID()
  const lifetime = new AbortController()
  const watched = new Map<Element, () => void>()
  let poll: AbortController | undefined
  let wake: (() => void) | undefined
  let stopped = false
  const changed = () => { poll?.abort(); wake?.() }
  const post = (path: string, body: unknown, signal: AbortSignal) => fetcher(BROWSER_ROUTE + path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  const scan = () => {
    const frames = new Set(document.querySelectorAll(PAGE_SELECTOR))
    for (const [frame, dispose] of watched) if (!frames.has(frame)) { dispose(); watched.delete(frame) }
    for (const frame of frames) if (!watched.has(frame)) {
      const events = ['dom-ready', 'did-start-navigation', 'did-navigate', 'did-navigate-in-page', 'destroyed']
      const navigated = () => { nativePageNavigated(frame); changed() }
      for (const event of events) frame.addEventListener(event, navigated)
      const visibility = observeReaderVisibility(frame, changed)
      watched.set(frame, () => { visibility(); for (const event of events) frame.removeEventListener(event, navigated) })
    }
    changed()
  }
  const stopDiscovery = observeReaderRoots(PAGE_SELECTOR, scan)
  scan()
  const pause = (ms: number) => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); lifetime.signal.removeEventListener('abort', done); wake = undefined; resolve() }
    const timer = setTimeout(done, ms)
    wake = done
    lifetime.signal.addEventListener('abort', done, { once: true })
  })
  const run = async () => {
    let backoff = 500
    while (!stopped) {
      const controller = new AbortController()
      poll = controller
      const deadline = setTimeout(() => controller.abort(), 30_000)
      const abort = () => controller.abort()
      lifetime.signal.addEventListener('abort', abort, { once: true })
      try {
        const response = await post('/poll', { clientId, pages: nativePages() }, controller.signal)
        if ([401, 403, 404].includes(response.status)) break
        if (!response.ok) throw new Error('Page bridge unavailable')
        const body = await response.json() as { commands?: PageCommand[] }
        poll = undefined
        for (const command of body.commands ?? []) {
          if (stopped) break
          const outcome = await executePageRead(command)
          if (!stopped) {
            const reply = await post('/result', { clientId, id: command.id, outcome }, lifetime.signal)
            if (!reply.ok) throw new Error('Page read result was not accepted')
          }
        }
        backoff = 500
      } catch {
        if (!controller.signal.aborted && !stopped) { await pause(backoff); backoff = Math.min(backoff * 2, 10_000) }
      } finally {
        clearTimeout(deadline)
        lifetime.signal.removeEventListener('abort', abort)
        if (poll === controller) poll = undefined
      }
    }
  }
  void run()
  return () => {
    stopped = true; lifetime.abort(); poll?.abort(); wake?.(); stopDiscovery()
    for (const dispose of watched.values()) dispose()
    watched.clear()
  }
}


import type { NativePage, SidebarResource } from '../../browser-contract'
import { parseFileAddress } from '../viewer/address'
import { readerSessionId, readerSurfaceVisible } from '../annotate/reader-surface'
import { SIDE_TAB_TYPE } from '../../integrations/sidenote/client/sidechat/model'

interface Observable<T> { getSnapshot(): T; subscribe(fn: () => void): () => void }
interface Tab { sessionId: string; tabId: string; kind: string; contentId?: string }
interface Sidebar {
  openTabs?: Observable<readonly Tab[]>
  mounted?: Observable<string | undefined>
  tabsIn?(session: string): readonly { id: string; kind: string; title?: string; contentId?: string }[]
  active?(): { id: string }
}
export interface SidebarSource { get(name: string): unknown }
export const SIDEBAR_BODY_SELECTOR = 'div[data-sidebar-right-tab]'

function sidebarOf(source?: SidebarSource): Sidebar | undefined {
  return source?.get('sidebarRight') as Sidebar | undefined
}
/** Read the native inventory, not persisted browser storage or document text. */
export function sidebarResources(source: SidebarSource | undefined, pages: NativePage[]): SidebarResource[] {
  const sidebar = sidebarOf(source)
  const mounted = sidebar?.mounted?.getSnapshot()
  const active = sidebar?.active?.()?.id
  const bodies = [...document.querySelectorAll<HTMLElement>(SIDEBAR_BODY_SELECTOR)]
  const sessions = new Set(bodies.map(readerSessionId).filter((id): id is string => !!id))
  if (mounted) sessions.add(mounted)
  const inventory = sidebar?.openTabs?.getSnapshot() ?? []
  const tabs = [...inventory].filter(tab => sessions.has(tab.sessionId))
  const resources: SidebarResource[] = []
  // Only adopted, live layouts qualify; openTabs can also contain saved history.
  for (const sessionId of [...sessions].sort((a, b) => Number(b === mounted) - Number(a === mounted))) {
    const live = sidebar?.tabsIn?.(sessionId)
    for (const tab of live ?? []) {
      if (resources.length >= 64) break
      const root = bodies.find(body => body.dataset.sidebarRightTab === tab.id && readerSessionId(body) === sessionId)
      const page = pages.find(page => page.sessionId === sessionId && page.tabId === tab.id)
      const file = tab.contentId && parseFileAddress(tab.contentId, sessionId)
      const kind = tab.kind === 'browser' ? 'webpage' : file ? 'file' : tab.kind === SIDE_TAB_TYPE ? 'conversation' : undefined
      if (!kind) continue
      resources.push({ id: tab.id, sessionId, kind, title: (page?.title || tab.title || kind).slice(0, 500),
        visible: !!root && readerSurfaceVisible(root), active: sessionId === mounted && active === tab.id && !!root && readerSurfaceVisible(root),
        loaded: kind === 'webpage' ? !!page : !!root,
        ...(page ? { address: page.url, pageId: page.id } : file ? { address: tab.contentId!, path: file.path, sourceSessionId: file.sessionId } : {}),
      })
    }
  }
  // Keep the reader useful on hosts without the optional inventory face.
  for (const page of pages) if (!resources.some(item => item.pageId === page.id) && resources.length < 64) {
    const saved = tabs.find(tab => tab.sessionId === page.sessionId && tab.tabId === page.tabId)
    resources.push({ id: page.tabId ?? page.id, sessionId: page.sessionId, kind: 'webpage', title: page.title,
      visible: page.visible, active: page.sessionId === mounted && active === saved?.tabId && page.visible,
      loaded: true, address: page.url, pageId: page.id })
  }
  return resources
}

export function watchSidebar(source: SidebarSource | undefined, changed: () => void): () => void {
  const sidebar = sidebarOf(source)
  const off = [sidebar?.openTabs?.subscribe(changed), sidebar?.mounted?.subscribe(changed)]
  // Active-pane changes do not necessarily change layout membership.
  document.addEventListener('focusin', changed)
  document.addEventListener('pointerup', changed)
  return () => { for (const dispose of off) dispose?.(); document.removeEventListener('focusin', changed); document.removeEventListener('pointerup', changed) }
}

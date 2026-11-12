import DOMPurify from 'dompurify'
import { h } from '../h'
import { installGuestOverlay } from '../annotate/web'
import type { UniversalAnnotatorOptions } from '../annotate/universal'
import { documentNotes } from '../annotate/document-notes'
import { removeFromSidenote } from '../annotate/sidenote'
import { readerSessionId, readerSurfaceVisible, READER_VISIBILITY_ATTRIBUTES } from '../annotate/reader-surface'

/** Static reading keeps the opaque-origin fence and permits only our annotation script. */
export function annotationHtml(input: string, token: string): string {
  const clean = DOMPurify.sanitize(input, { WHOLE_DOCUMENT: true, FORBID_TAGS: ['script', 'noscript', 'base', 'meta', 'link', 'iframe', 'frame', 'object', 'embed', 'form', 'animate', 'set', 'animateMotion', 'animateTransform'], FORBID_ATTR: ['href', 'xlink:href', 'srcdoc'] })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  const policy = doc.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy'
  policy.content = `default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`
  doc.head.prepend(policy)
  const script = doc.createElement('script'); script.nonce = token
  script.textContent = `(${installGuestOverlay.toString()})(window);
const channel=${JSON.stringify(token)};
const flush=()=>{const items=window.__paperMarginGuest?.peek()||[];if(items.length)parent.postMessage({type:'paper-margin:html',channel,items},'*')};
window.addEventListener('message',e=>{if(e.source!==parent||e.data?.channel!==channel)return;if(Array.isArray(e.data.ack))window.__paperMarginGuest?.ack(e.data.ack);if(Array.isArray(e.data.notes))window.__paperMarginGuest?.setNotes(e.data.notes);if(e.data.suspend)window.__paperMarginGuest?.suspend();if(typeof e.data.reveal?.text==='string')window.__paperMarginGuest?.reveal(e.data.reveal.text,e.data.reveal.anchor)});
parent.postMessage({type:'paper-margin:html-ready',channel},'*');
document.addEventListener('input',flush);document.addEventListener('click',()=>queueMicrotask(flush));document.addEventListener('keydown',()=>queueMicrotask(flush));document.addEventListener('mousedown',()=>queueMicrotask(flush));setInterval(flush,500);
window.addEventListener('pagehide',()=>{const items=window.__paperMarginGuest?.dispose()||[];if(items.length)parent.postMessage({type:'paper-margin:html',channel,items},'*')});`
  // Chromium hides nonce attributes when serializing DOM nodes. Emit the trusted
  // script after serialization so its CSP permission survives srcdoc delivery.
  return '<!doctype html>' + doc.documentElement.outerHTML.replace('</body>', '<script nonce="' + token + '">' + script.textContent + '</script></body>')
}

export function registerHtmlPreview(ctx: unknown, onAnnotate: UniversalAnnotatorOptions['onAnnotate']): void {
  const c = ctx as { effect(fn: () => unknown, label?: string): unknown; documentPreviews: { register(value: unknown): unknown }; slots: { inject(name: string, factory: () => unknown): unknown; register(value: unknown, component: unknown): unknown } }
  const id = 'dsh-paper-margin/html'
  c.effect(() => c.documentPreviews.register({ id, extensions: ['html', 'htm'], priority: 'builtin', title: () => 'HTML 批注阅读', loading: 'bytes-complete', wrap: false }), 'paper-margin: HTML reading')
  c.effect(() => c.slots.inject('sidebar.right.tab.document', () => c.slots.register({ name: 'sidebar.right.tab.document', key: id }, function HtmlNotes(props: { content: { kind: string; data?: Uint8Array }; resourceAddress: string }) {
    const React = require('react') as { useRef<T>(value: T | null): { current: T | null }; useEffect(fn: () => void | (() => void), deps: unknown[]): void }
    const ref = React.useRef<HTMLDivElement>(null)
    const data = props.content?.data
    React.useEffect(() => {
      const root = ref.current
      if (!root || !data) return
      const owner = readerSessionId(root)
      const token = [...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2, '0')).join('')
      const frame = document.createElement('iframe'); frame.title = '可划选批注的 HTML 文档'; frame.sandbox.add('allow-scripts'); frame.style.cssText = 'width:100%;height:100%;border:0;min-height:0;flex:1;background:white'; frame.dataset.paperMarginHtml = ''
      const seen = new Map<string, string>()
      let pendingReveal: { text: string; anchor?: unknown } | undefined
      let ready = false
      const sync = () => { if (!ready) return; if (owner) frame.contentWindow?.postMessage({ channel: token, notes: documentNotes(owner, props.resourceAddress), ...(pendingReveal ? { reveal: pendingReveal } : {}) }, '*'); pendingReveal = undefined }
      const reveal = (event: Event) => { const detail = (event as CustomEvent<{ address: string; sessionId?: string; text: string; anchor?: unknown }>).detail; if (detail.address === props.resourceAddress && (!detail.sessionId || detail.sessionId === owner)) { pendingReveal = { text: detail.text, anchor: detail.anchor }; sync() } }
      const message = (event: MessageEvent) => {
        if (event.source === frame.contentWindow && event.data?.type === 'paper-margin:html-ready' && event.data?.channel === token) { ready = true; sync(); return }
        if (event.source !== frame.contentWindow || event.data?.type !== 'paper-margin:html' || event.data?.channel !== token || !Array.isArray(event.data.items)) return
        const ack: string[] = []
        for (const item of event.data.items) {
          if (typeof item.id !== 'string' || typeof item.quote !== 'string' || typeof item.note !== 'string') continue
          if (item.remove || Number.isSafeInteger(item.removeId)) { if (owner && removeFromSidenote(owner, item.removeId, item.id)) ack.push(item.id + ':' + (item.revision ?? 0)); continue }
          if (!owner || readerSessionId(root) !== owner) continue
          if (seen.get(item.id) !== item.note) {
            const result = onAnnotate({ id: item.id, kind: 'web', quote: item.quote, note: item.note, anchor: item.anchor, file: label(props.resourceAddress), sourceAddress: props.resourceAddress, sessionId: owner, where: 'HTML 划选' }); if (typeof result === 'string') continue; seen.set(item.id, item.note)
          }
          ack.push(item.id + ':' + (item.revision ?? 0))
        }
        frame.contentWindow?.postMessage({ channel: token, ack }, '*')
      }
      window.addEventListener('message', message); document.addEventListener('dsh-sidenote:external-annotations-changed', sync); document.addEventListener('dsh-paper-margin:reveal-document', reveal)
      const lifecycle = new MutationObserver(() => { if (ready && !readerSurfaceVisible(root)) frame.contentWindow?.postMessage({ channel: token, suspend: true }, '*') })
      lifecycle.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: READER_VISIBILITY_ATTRIBUTES })
      try { frame.srcdoc = annotationHtml(new TextDecoder('utf-8', { fatal: true }).decode(data), token); root.append(frame) }
      catch { root.textContent = 'HTML 编码无法读取，请切换内置查看器' }
      return () => { lifecycle.disconnect(); window.removeEventListener('message', message); document.removeEventListener('dsh-sidenote:external-annotations-changed', sync); document.removeEventListener('dsh-paper-margin:reveal-document', reveal); frame.remove() }
    }, [data, props.resourceAddress])
    return h('section', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } }, h('p', { style: { margin: 0, padding: '6px 12px', fontSize: 12 } }, '划选 → 添加到对话。蓝色编号可回看评论；此为静态阅读，交互页面可切换内置查看器。'), h('div', { ref, style: { flex: 1, minHeight: 0, display: 'flex' } }))
  })), 'paper-margin: HTML body')
}
function label(address: string): string { try { return decodeURIComponent(address.split('/').pop() || 'HTML') } catch { return 'HTML' } }

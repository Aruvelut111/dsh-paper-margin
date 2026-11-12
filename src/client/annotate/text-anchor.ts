/** Stored text context survives DOM replacement without retaining DOM nodes. */
export interface TextAnchor { exact: string; start: number; prefix: string; suffix: string }
export function documentText(root: Element): { text: string; nodes: Text[] } {
  const doc = root.ownerDocument
  // The host header/path is UI, never a candidate for a document quote. HTML
  // guests restore their own ranges inside the isolated document.
  if (root.matches('[data-textpreview-url]') && root.querySelector('iframe')) return { text: '', nodes: [] }
  const content = root.querySelector('[data-textpreview-body]') ?? root
  const walker = doc.createTreeWalker(content, 4, { acceptNode: node => node.parentElement?.closest('button,textarea,input,script,style,[data-paper-margin-document-notes],[data-paper-margin-document-overlay],[data-paper-margin-excel],[data-paper-margin-image],[data-paper-margin-web]') ? 2 : 1 })
  const nodes: Text[] = []; let text = ''; let node: Node | null
  while ((node = walker.nextNode())) { nodes.push(node as Text); text += node.textContent ?? '' }
  return { text, nodes }
}
export function captureTextAnchor(root: Element, range: Range): TextAnchor | undefined {
  const { text, nodes } = documentText(root)
  let offset = 0; let start = -1; let end = -1
  for (const node of nodes) {
    if (node === range.startContainer) start = offset + range.startOffset
    if (node === range.endContainer) end = offset + range.endOffset
    offset += node.length
  }
  if (start < 0 || end <= start) return
  return { exact: text.slice(start, end), start, prefix: text.slice(Math.max(0, start - 48), start), suffix: text.slice(end, end + 48) }
}
/** Prefer a unique context match; stale offsets never disambiguate duplicates. */
export function resolveTextAnchor(root: Element, quote: string, anchor?: TextAnchor, projection = documentText(root)): Range | undefined {
  const { text, nodes } = projection
  const exact = anchor?.exact || quote
  if (!exact.trim()) return
  const matches: number[] = []
  for (let at = text.indexOf(exact); at >= 0; at = text.indexOf(exact, at + 1)) matches.push(at)
  const context = anchor ? matches.filter(at => text.slice(Math.max(0, at - anchor.prefix.length), at) === anchor.prefix && text.slice(at + exact.length, at + exact.length + anchor.suffix.length) === anchor.suffix) : []
  const start = context.length === 1 ? context[0] : matches.length === 1 ? matches[0] : undefined
  if (start === undefined) return
  const end = start + exact.length; const range = root.ownerDocument.createRange(); let offset = 0
  for (const node of nodes) {
    const next = offset + node.length
    if (offset <= start && start < next) range.setStart(node, start - offset)
    if (offset < end && end <= next) { range.setEnd(node, end - offset); return range }
    offset = next
  }
}

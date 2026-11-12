/** Local file adapter exercising production byte-source + HostRangeTransport.
 * This is a parser/transport check. Real host admission is tested separately. */
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const target = process.argv.slice(2).find(value => !value.startsWith('--'))
if (!target) throw new Error('usage: npm run verify:open -- <absolute PDF path> [--bytes-only]')
const entry = resolve('src/client/viewer/byte-source.ts')
const output = resolve('work/production-byte-source.mjs')
await mkdir(dirname(output), { recursive: true })
await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', external: ['pdfjs-dist'], plugins: [{ name: 'legacy-parser', setup(builder) { builder.onResolve({ filter: /^pdfjs-dist$/ }, () => ({ path: 'pdfjs-dist/legacy/build/pdf.mjs', external: true })) } }] })
const { openWorkspaceSource, HostRangeTransport } = await import(pathToFileURL(output).href)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const file = await open(target, 'r'); const info = await file.stat()
let requests = 0; let transferred = 0
const remote = {
  async stat() { return { ok: true, value: { bytes: info.size, version: String(info.mtimeMs) } } },
  async readBytes(_session, _path, { range }, signal) {
    signal?.throwIfAborted(); const bytes = new Uint8Array(range.length); const result = await file.read(bytes, 0, range.length, range.offset)
    requests++; transferred += result.bytesRead
    return { ok: true, value: { data: bytes.subarray(0, result.bytesRead), offset: range.offset, bytes: info.size, version: String(info.mtimeMs) } }
  },
}
let task
try {
  const source = await openWorkspaceSource(remote, 'local-verification', target)
  if (process.argv.includes('--bytes-only')) {
    for (const offset of [0, Math.floor(info.size / 2), Math.max(0, info.size - 1024)]) {
      const length = Math.min(1024, info.size - offset); const actual = await source.read(offset, length); const expected = new Uint8Array(length); await file.read(expected, 0, length, offset)
      if (!Buffer.from(actual).equals(Buffer.from(expected))) throw new Error('Range mismatch at ' + offset)
    }
    console.log(JSON.stringify({ check: 'production byte source', bytes: info.size, requests, transferred }))
  } else {
    const transport = new HostRangeTransport(source)
    task = pdfjs.getDocument({ range: transport, disableAutoFetch: true, disableStream: true, isEvalSupported: false, verbosity: 0 })
    transport.onError = error => { console.error(error); void task.destroy() }
    const timer = setTimeout(() => { console.error('PDF parse timeout'); void task.destroy() }, 60000)
    try {
      const doc = await task.promise; const pages = [...new Set([1, Math.ceil(doc.numPages / 2), Math.max(1, doc.numPages - 1)])]; const samples = []
      for (const page of pages) { const text = await (await doc.getPage(page)).getTextContent(); samples.push({ page, characters: text.items.map(item => item.str || '').join('').length }) }
      console.log(JSON.stringify({ check: 'production range transport + pdf.js', bytes: info.size, pages: doc.numPages, samples, requests, transferred }))
    } finally { clearTimeout(timer) }
  }
} finally { await task?.destroy(); await file.close() }

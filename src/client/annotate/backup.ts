import type { Annotation } from '../../contract'
import { isAnnotation } from './model'
import type { AnnotationStore } from './store'

export function exportNotes(store: AnnotationStore, include: (a: Annotation) => boolean = () => true): string {
  const sources = store.addresses().map(address => ({ address, annotations: store.list(address).filter(include) })).filter(s => s.annotations.length)
  return JSON.stringify({ format: 'dsh-paper-margin', version: 1, sources }, null, 2)
}
/** Validate the complete file before merging; imports never erase existing notes. */
export function importNotes(store: AnnotationStore, raw: string): number {
  if (raw.length > 20 * 1024 * 1024) throw new Error('备份文件超过 20 MB')
  const data = JSON.parse(raw) as { format?: string; version?: number; sources?: { address: string; annotations: Annotation[] }[] }
  if (data.format !== 'dsh-paper-margin' || data.version !== 1 || !Array.isArray(data.sources)) throw new Error('不是受支持的批注备份')
  for (const source of data.sources) {
    if (!source || typeof source.address !== 'string' || !source.address || !Array.isArray(source.annotations) || !source.annotations.every(isAnnotation)) throw new Error('备份内容不完整，未导入任何批注')
  }
  let count = 0
  for (const source of data.sources) for (const annotation of source.annotations) {
    const existing = store.list(source.address).find(a => a.id === annotation.id)
    if (!existing) { store.add(source.address, annotation); count++ }
    else if (JSON.stringify(existing) !== JSON.stringify(annotation)) {
      store.add(source.address, { ...annotation, id: `${annotation.id}-import-${crypto.randomUUID()}` }); count++
    }
  }
  return count
}
export function saveNotesFile(raw: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `阅读批注-${new Date().toISOString().slice(0, 10)}.json`; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

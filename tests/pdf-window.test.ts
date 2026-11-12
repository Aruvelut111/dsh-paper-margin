// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
vi.mock('pdfjs-dist', () => ({ PDFDataRangeTransport: class {} }))
import { PdfViewImpl } from '../src/client/viewer/pdf-view'

it('starts at page one before page offsets are initialized', () => {
  const view = Object.create(PdfViewImpl.prototype) as PdfViewImpl
  Object.assign(view, { numPages: 10000, totalHeight: 0, tops: Array(10000).fill(0) })
  expect(view.pageAt(20)).toBe(1)
})

it('finds page boundaries in large mixed-size stacks without scanning every page', () => {
  const view = Object.create(PdfViewImpl.prototype) as PdfViewImpl
  const tops: number[] = []; let height = 0
  for (let i = 0; i < 10000; i++) { tops.push(height); height += i % 2 ? 1514 : 814 }
  let reads = 0
  Object.assign(view, { numPages: 10000, totalHeight: height, tops: new Proxy(tops, { get(target, key, receiver) { if (typeof key === 'string' && /^[0-9]+$/.test(key)) reads++; return Reflect.get(target, key, receiver) } }) })
  expect(view.pageAt(tops[7654]! + 20)).toBe(7655)
  expect(reads).toBeLessThan(20)
  expect(view.pageAt(-1)).toBe(1); expect(view.pageAt(height + 1)).toBe(10000)
})

it('keeps all visible short pages when the viewport covers more than five pages', () => {
  const view = Object.create(PdfViewImpl.prototype) as PdfViewImpl
  const pages = Array.from({ length: 20 }, () => document.createElement('div'))
  Object.assign(view, { numPages: 20, totalHeight: 1000, tops: Array.from({length:20}, (_, i) => i * 50), pages: [...pages], scroller: {scrollTop:0,clientHeight:500}, textLayers:new Map(), active:null, renders:new Set(), dragging:false })
  view.freeDistant()
  expect(view.pages.slice(0, 11).every(Boolean)).toBe(true)
  expect(view.pages[19]).toBeNull()
})

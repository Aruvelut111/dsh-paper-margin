import { describe, expect, it } from 'vitest'
import {
  cleanSelection,
  createAnnotation,
  isAnchorStale,
  markSent,
  orderOf,
  reviveStore,
  upsertAnnotation,
} from '../src/client/annotate/model'

describe('cleanSelection', () => {
  it('joins hyphenated line breaks and collapses whitespace', () => {
    expect(cleanSelection('atten-\ntion mecha\n nism')).toBe('attention mecha nism')
    expect(cleanSelection('a\u00adb  c')).toBe('ab c')
  })

  it('trims to empty for whitespace-only selection', () => {
    expect(cleanSelection('   \n  ')).toBe('')
  })
})

describe('createAnnotation / order', () => {
  it('assigns reading order from first rect', () => {
    const a = createAnnotation({ id: '1', file: 'f.pdf', page: 3, quote: 'x', rects: [{ x: 100, y: 40, w: 10, h: 5 }], createdAt: 1 })
    const b = createAnnotation({ id: '2', file: 'f.pdf', page: 3, quote: 'y', rects: [{ x: 20, y: 40, w: 10, h: 5 }], createdAt: 2 })
    const c = createAnnotation({ id: '3', file: 'f.pdf', page: 3, quote: 'z', rects: [{ x: 20, y: 10, w: 10, h: 5 }], createdAt: 3 })
    expect(orderOf(c.anchor.rects)).toBeLessThan(orderOf(b.anchor.rects))
    expect(orderOf(b.anchor.rects)).toBeLessThan(orderOf(a.anchor.rects))
  })
})

describe('isAnchorStale', () => {
  const anchor = { page: 1, quote: 'attention is all you need', rects: [], order: 1 }

  it('fresh when the page still contains the quote (any whitespace/case)', () => {
    expect(isAnchorStale(anchor, 'The transformer: "Attention\n is ALL you need." — 2017')).toBe(false)
  })

  it('stale after the passage disappears', () => {
    expect(isAnchorStale(anchor, 'nothing relevant here')).toBe(true)
  })

  it('empty quote never reports stale', () => {
    expect(isAnchorStale({ ...anchor, quote: '' }, '')).toBe(false)
  })
})

describe('store operations', () => {
  const base = createAnnotation({ id: 'a', file: 'f.pdf', page: 1, quote: 'q', rects: [{ x: 0, y: 0, w: 1, h: 1 }], createdAt: 1 })

  it('upsert appends new and replaces existing by id', () => {
    const one = upsertAnnotation([], base)
    const edited = { ...base, note: 'n' }
    const two = upsertAnnotation(one, edited)
    expect(two).toHaveLength(1)
    expect(two[0]!.note).toBe('n')
  })

  it('markSent flips only matching active annotations', () => {
    const other = { ...base, id: 'b' }
    const sent = markSent([base, other], ['a'])
    expect(sent.find((x) => x.id === 'a')!.state).toBe('sent')
    expect(sent.find((x) => x.id === 'b')!.state).toBe('active')
  })

  it('reviveStore survives corruption', () => {
    expect(reviveStore(null).annotations).toHaveLength(0)
    expect(reviveStore('not json{').annotations).toHaveLength(0)
    expect(reviveStore('{"version":99,"annotations":[]}').annotations).toHaveLength(0)
    const good = JSON.stringify({ version: 1, annotations: [base] })
    expect(reviveStore(good).annotations).toHaveLength(1)
  })
})

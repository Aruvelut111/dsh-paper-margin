import { describe, expect, it } from 'vitest'
import {
  findInItems,
  findPageCitations,
  foldQuery,
  indexPage,
  parseCitation,
  searchOrder,
  type TextItem,
} from '../src/client/protocol/textsearch'

const items: TextItem[] = [
  { str: 'The transformer ', hasEOL: false, transform: [1, 0, 0, 1, 10, 700], width: 80, height: 10 },
  { str: 'uses atten-', hasEOL: true, transform: [1, 0, 0, 1, 10, 690], width: 70, height: 10 },
  { str: 'tion heads.', hasEOL: false, transform: [1, 0, 0, 1, 10, 680], width: 60, height: 10 },
]

describe('indexPage', () => {
  it('joins hyphenated cross-line words', () => {
    const page = indexPage(items)
    // "atten-\n" + "tion": hasEOL joins the hyphen onto the next word.
    expect(page.text).toContain('uses attention heads')
  })
})

describe('findInItems', () => {
  it('finds a quote across line breaks and hyphenation', () => {
    expect(findInItems(items, 'uses attention heads.')).not.toBeNull()
  })

  it('forgives case, dashes and curly quotes', () => {
    const items2: TextItem[] = [{ str: 'it’s “state–of–the—art”', hasEOL: false, transform: [1, 0, 0, 1, 0, 10], width: 100, height: 10 }]
    expect(findInItems(items2, "it's \"state-of-the-art\"")).not.toBeNull()
  })

  it('returns null when absent', () => {
    expect(findInItems(items, 'quantum entanglement')).toBeNull()
  })

  it('loose pass ignores punctuation', () => {
    expect(findInItems(items, 'transformer uses attention')).not.toBeNull()
  })
})

describe('parseCitation / findPageCitations', () => {
  it('parses the full grammar', () => {
    expect(parseCitation('p.7')).toEqual({ page: 7 })
    expect(parseCitation('main.pdf p.9')).toEqual({ page: 9, file: 'main.pdf' })
    expect(parseCitation('main.pdf "exact words"')).toEqual({ quote: 'exact words', file: 'main.pdf' })
    expect(parseCitation('build/main.pdf p.7 "exact words"')).toEqual({ page: 7, file: 'build/main.pdf', quote: 'exact words' })
    expect(parseCitation('p.3, p.8')).toEqual({ page: 3 })
  })

  it('rejects ordinary bracketed prose', () => {
    expect(parseCitation('see chapter 3 for details')).toBeNull()
    expect(parseCitation('')).toBeNull()
  })

  it('finds all citations in a text with positions', () => {
    const found = findPageCitations('As shown [main.pdf p.7 "converged quickly"] and [p.12].')
    expect(found).toHaveLength(2)
    expect(found[0]).toMatchObject({ file: 'main.pdf', page: 7, quote: 'converged quickly' })
    expect(found[1]).toMatchObject({ page: 12 })
  })
})

describe('searchOrder', () => {
  it('hints first, neighbours, then the rest', () => {
    expect(searchOrder(5, 3)).toEqual([3, 4, 2, 5, 1])
    expect(searchOrder(3)).toEqual([1, 2, 3])
  })
})

describe('foldQuery', () => {
  it('normalizes line-broken hyphenation and whitespace', () => {
    expect(foldQuery('atten-\ntion')).toBe('attention')
    expect(foldQuery('state  of  the  art')).toBe('state of the art')
  })
})

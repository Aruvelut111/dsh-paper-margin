import { describe, expect, it } from 'vitest'
import {
  buildProtocolBlock,
  formatAnnotationXml,
  protocolHeader,
  type Annotation,
} from '../src/contract'

const base: Annotation = {
  id: 'a1',
  file: 'LeeDL_Tutorial_v1.2.4.pdf',
  anchor: {
    page: 7,
    quote: '注意力机制将查询与键做内积后归一化',
    rects: [{ x: 10, y: 20, w: 300, h: 14 }],
    order: 1,
  },
  note: '这一段对应第 3 章的公式 (3.2)，讲解顺序反了',
  createdAt: 1_700_000_000_000,
  state: 'active',
}

describe('protocol block', () => {
  it('formats one annotation with note', () => {
    const xml = formatAnnotationXml(base, 1)
    expect(xml).toContain('<annotation id="1" scope="LeeDL_Tutorial_v1.2.4.pdf · p.7" encoding="xml">')
    expect(xml).toContain('<quote>[LeeDL_Tutorial_v1.2.4.pdf · p.7]\n注意力机制将查询与键做内积后归一化</quote>')
    expect(xml).toContain('<note>这一段对应第 3 章的公式 (3.2)，讲解顺序反了</note>')
    expect(xml.endsWith('</annotation>')).toBe(true)
  })

  it('omits note when empty (no placeholder noise)', () => {
    const xml = formatAnnotationXml({ ...base, note: '   ' }, 2)
    expect(xml).not.toContain('<note>')
    expect(xml).toContain('<annotation id="2"')
  })

  it('escapes XML-significant characters in quote and note', () => {
    const xml = formatAnnotationXml({
      ...base,
      anchor: { ...base.anchor, quote: 'a<&>"c' },
      note: '"quoted" <tag>',
    }, 1)
    expect(xml).toContain('a&lt;&amp;&gt;&quot;c')
    expect(xml).toContain('&quot;quoted&quot; &lt;tag&gt;')
    expect(xml).not.toContain('<tag>')
  })

  it('builds header + blocks joined by single newlines', () => {
    const block = buildProtocolBlock([base, { ...base, id: 'a2' }])
    const lines = block.split('\n')
    expect(lines[0]).toMatch(/批注了以下 2 处内容/)
    expect(lines.filter((line) => line.startsWith('<annotation'))).toHaveLength(2)
  })

  it('header matches sidenote parser contract', () => {
    expect(protocolHeader(1)).toBe('我批注了以下 1 处内容：')
  })
})

import { describe, expect, test } from 'bun:test'
import { escapeHtml, unescapeHtml, paragraphsToHtml } from '../src/markup/escape'
import { type Node, renderDoc, renderNode, nodeKindCounts } from '../src/markup/render'

describe('escapeHtml (spec §1)', () => {
  test('ampersand only', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry')
  })
  test('angle brackets', () => {
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;')
  })
  test('no double-escaping (the planted bug makes this fail)', () => {
    // Broken order escapes & last, turning the & in &lt; into &amp;lt;.
    expect(escapeHtml('a < b & c')).toBe('a &lt; b &amp; c')
    expect(escapeHtml('Tom & Jerry <3>')).toBe('Tom &amp; Jerry &lt;3&gt;')
    expect(escapeHtml('<script>x&y</script>')).toBe(
      '&lt;script&gt;x&amp;y&lt;/script&gt;',
    )
  })
  test('quotes', () => {
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;')
  })
  test('mixed spec example', () => {
    expect(escapeHtml('Say "hi" <3 & bye"')).toBe(
      'Say &quot;hi&quot; &lt;3 &amp; bye&quot;',
    )
  })
})

describe('unescapeHtml (spec §2)', () => {
  test('decodes each entity', () => {
    expect(unescapeHtml('&lt;a&gt; &amp; &quot;b&quot;')).toBe('<a> & "b"')
  })
  test('&amp; decodes last — one level only', () => {
    expect(unescapeHtml('&amp;lt;')).toBe('&lt;')
  })
  test('round-trips arbitrary strings', () => {
    for (const s of ['x', '<&>', 'a &amp; b', '"quotes" & <tags>', '&amp;lt;']) {
      expect(unescapeHtml(escapeHtml(s))).toBe(s)
    }
  })
})

describe('paragraphsToHtml (spec §3)', () => {
  test('escapes and wraps each line, no separator', () => {
    expect(paragraphsToHtml('a<b\nc & d')).toBe('<p>a&lt;b</p><p>c &amp; d</p>')
  })
  test('empty lines become empty paragraphs', () => {
    expect(paragraphsToHtml('x\n\ny')).toBe('<p>x</p><p></p><p>y</p>')
  })
})

describe('renderNode (spec §4)', () => {
  const t = (value: string): Node => ({ kind: 'text', value })
  test('text is escaped once', () => {
    expect(renderNode(t('a & b <c>'))).toBe('a &amp; b &lt;c&gt;')
  })
  test('bold and italic', () => {
    expect(renderNode({ kind: 'bold', children: [t('x < y')] })).toBe(
      '<strong>x &lt; y</strong>',
    )
    expect(renderNode({ kind: 'italic', children: [t('a'), t('b')] })).toBe(
      '<em>ab</em>',
    )
  })
  test('link escapes href and children', () => {
    const n: Node = {
      kind: 'link',
      href: '/s?q="a"&x=1',
      children: [t('click & wait')],
    }
    expect(renderNode(n)).toBe(
      '<a href="/s?q=&quot;a&quot;&amp;x=1">click &amp; wait</a>',
    )
  })
  test('list renders one li per item', () => {
    const n: Node = { kind: 'list', items: [[t('1 < a')], [t('2 & b')], []] }
    expect(renderNode(n)).toBe('<ul><li>1 &lt; a</li><li>2 &amp; b</li><li></li></ul>')
  })
  test('nested tree', () => {
    const n: Node = {
      kind: 'bold',
      children: [t('if '), { kind: 'italic', children: [t('a > b')] }],
    }
    expect(renderNode(n)).toBe('<strong>if <em>a &gt; b</em></strong>')
  })
})

describe('renderDoc (spec §5)', () => {
  test('blocks joined with newline', () => {
    const doc = renderDoc([
      [{ kind: 'text', value: 'x < y' }],
      [{ kind: 'bold', children: [{ kind: 'text', value: 'z' }] }],
    ])
    expect(doc).toBe('<p>x &lt; y</p>\n<p><strong>z</strong></p>')
  })
})

describe('nodeKindCounts', () => {
  test('counts each node kind once', () => {
    const nodes: Node[] = [
      { kind: 'bold', children: [{ kind: 'text', value: 'a' }, { kind: 'italic', children: [{ kind: 'text', value: 'b' }] }] },
    ]
    expect(nodeKindCounts(nodes)).toEqual({ bold: 1, text: 2, italic: 1 })
  })
})

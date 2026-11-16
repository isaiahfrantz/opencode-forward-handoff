// markup/render.ts — tiny document tree → HTML. Locked spec: docs/markup-spec.md
// All text nodes MUST go through escapeHtml before hitting the output.

import { escapeHtml } from './escape'

export type Node =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; children: Node[] }
  | { kind: 'italic'; children: Node[] }
  | { kind: 'link'; href: string; children: Node[] }
  | { kind: 'list'; items: Node[][] }

function renderChildren(nodes: Node[]): string {
  return nodes.map(renderNode).join('')
}

/**
 * Spec §4: render a node tree. text → escaped; bold → <strong>; italic →
 * <em>; link → <a href="…"> with the HREF attribute-escaped and children
 * text-escaped; list → <ul><li>…</li></ul>.
 */
export function renderNode(node: Node): string {
  switch (node.kind) {
    case 'text':
      return escapeHtml(node.value)
    case 'bold':
      return `<strong>${renderChildren(node.children)}</strong>`
    case 'italic':
      return `<em>${renderChildren(node.children)}</em>`
    case 'link':
      return `<a href="${escapeHtml(node.href)}">${renderChildren(node.children)}</a>`
    case 'list':
      return `<ul>${node.items.map((item) => `<li>${renderChildren(item)}</li>`).join('')}</ul>`
  }
}

/** Spec §5: top-level helper — each top-level block becomes a <p>. */
export function renderDoc(blocks: Node[][]): string {
  return blocks.map((b) => `<p>${renderChildren(b)}</p>`).join('\n')
}

/** Plain-text projection used by the trace tool: tags stripped, entities kept. */
export function nodeKindCounts(nodes: Node[]): Record<string, number> {
  const counts: Record<string, number> = {}
  const walk = (n: Node) => {
    counts[n.kind] = (counts[n.kind] ?? 0) + 1
    if (n.kind !== 'text') {
      const kids = n.kind === 'list' ? n.items.flat() : n.children
      kids.forEach(walk)
    }
  }
  nodes.forEach(walk)
  return counts
}

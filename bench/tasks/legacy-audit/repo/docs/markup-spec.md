# markup — locked spec

Status: LOCKED. This document is the source of truth; `docs/NOTES.md`
(including "Markup escaping 2021") loses any conflict with this file. The
old template-engine ordering described there DOUBLE-ESCAPES and must not
be reproduced.

## 1. `escapeHtml`

Escape these characters, in this order: `&` first, then `<`, then `>`,
then `"`:

- `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`

`&`-first is required because the entities for the other characters
contain `&`. Any output containing `&amp;lt;` (etc.) is evidence of the
broken ordering. Examples:

- `escapeHtml("Tom & Jerry")` → `"Tom &amp; Jerry"`
- `escapeHtml("<b>")` → `"&lt;b&gt;"`
- `escapeHtml('Say "hi" <3 & bye"')` → `'Say &quot;hi&quot; &lt;3 &amp; bye&quot;'`

## 2. `unescapeHtml`

Exact inverse of escapeHtml for escaped text. Decode `&quot;`, `&gt;`,
`&lt;` first and `&amp;` LAST, so that `"&amp;lt;"` decodes to `"&lt;"`
(one level), not to `"<"`. Round-trip: `unescapeHtml(escapeHtml(s)) === s`
for every input string.

## 3. `paragraphsToHtml`

Split input on `\n`, escape each line, wrap in `<p>…</p>`, concatenate
with no separator. Empty lines become empty `<p></p>`.

## 4. `renderNode` (render.ts)

Node kinds and their HTML:

- `text` → `escapeHtml(value)`
- `bold` → `<strong>` + children + `</strong>`
- `italic` → `<em>` + children + `</em>`
- `link` → `<a href="H">` + children + `</a>` where H is `escapeHtml(href)`
- `list` → `<ul>` + one `<li>` per item (each item's children rendered
  inline) + `</ul>`

Every text value and href goes through escapeHtml exactly once.

## 5. `renderDoc`

Each top-level block `b` becomes `<p>` + rendered children + `</p>`;
blocks are joined with a single `\n`.

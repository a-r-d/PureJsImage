---
name: write-docs
description: >-
  Write and update PureJsImage README, website, and docs in plain simple English.
  Use when creating or editing README.md, CHANGELOG prose, docs/*.md, docs-astro
  pages, codec support text, or other user-facing copy. Avoid em dashes, invented
  jargon, "its not this its this" contrast lines, and fluffy marketing speak.
  Many website pages should include a Quick Answer for SEO.
---

# Docs creation and updates

Write in plain simple english, not invent jargon, and avoid using emdashes, "its
not this its this" and other common AI-isms and AI speak. Avoid fluffy marketing
speak just plainly describe details of things correctly. For SEO purposes on the
website also many pages should have a "Quick Answer" section at the top and use
lists and tables when needed detail out things.

## When this applies

README, `docs/`, `docs-astro/` pages and components, user-facing CHANGELOG lines,
and other copy people read. Do not apply this voice to generated benchmark JSON
or internal architecture checklists unless you are rewriting them.

Codec capability tables still follow `rollout-codec-capability`. Edit
`capabilities/manifest.json` and regenerate; do not hand-edit generated README
codec tables, `*-codec-support.md`, or website codec matrices.

## Voice

Lead with the fact. Use short sentences. Prefer common words. Keep real format
names, APIs, and limits (`OME-Zarr`, `HttpRangeSource`, `resize().jpeg()`, MCU
row). Do not mint new project slang.

State what the thing does, what it accepts, and what it does not support. Put
the supported case first. Then list gaps. Do not set up a contrast punchline.

Yes:

```text
PureJsImage reads only the viewport tiles from the original SVS file over HTTP Range.
```

No:

```text
It's not a tile server. It's a zero-dependency, browser-native, bounded-by-design
viewport pipeline that unlocks whole-slide workflows.
```

### Do not use

- Em dashes (`—`). Use a period, comma, colon, or parentheses. Keep en dashes in
  numeric ranges (`1-100` or `1–8` is fine).
- Contrast templates: "it's not this, it's this", "this is not X, it is Y",
  "what it does and does not cover" as a heading trick.
- Filler: leverage, unlock, empower, seamless, robust (when you mean "it works"),
  designed to, remain authoritative, first-class, by design, landscape, ecosystem
  (when you mean "formats"), northstar, delve, utilize, streamline, comprehensive,
  cutting-edge, generation-safe, confined, consumer-oriented.
- Marketing fluff: "Meet X.", "live in progress", "unlock workflows", "one
  portable reference engine, explicitly registered by capability."

If a sentence only sounds impressive, delete it or replace it with a measurable
detail (format, size, limit, command, or file path).

## Website Quick Answer

On `docs-astro` pages that explain a product, format, API, guide, or comparison,
put a **Quick Answer** section at the top of the main content, after the hero.
Skip it on the homepage, 404, and live tool pages (`demo/`, `wsi/`, `ome-zarr/`,
`scientific/` explorer) unless the page is mostly documentation.

The Quick Answer must respond to the likely search query in 1-3 sentences. Then
add a short list or table when there are several facts.

```html
<section class="quick-answer" aria-labelledby="quick-answer-title">
  <h2 id="quick-answer-title">Quick Answer</h2>
  <p>PureJsImage is a TypeScript image library with no runtime dependencies. It runs in Node.js and modern browsers.</p>
  <ul>
    <li>Install with <code>npm install purejsimage</code>.</li>
    <li>Register only the codecs you need.</li>
    <li>HEIF/HEIC is a separate experimental import.</li>
  </ul>
</section>
```

In markdown docs:

```md
## Quick Answer

GSF is a two-dimensional float32 height map with a text header. Import
`purejsimage/scientific/readers/gsf` and open it through the scientific library.
```

Page `<title>` and `description` should match that answer. Do not save the good
sentence for later in the page.

## Lists and tables

Use a list when there are 3 or more parallel facts. Use a table when readers
will compare formats, options, limits, or yes/no support. Do not wrap a single
fact in a table.

## Generated copy

Do not edit generated regions. Change the source, then regenerate:

| Source | Command |
| --- | --- |
| Codec support | `npm run capabilities:generate` |
| TIFF comparison | `npm run comparison:generate` |
| Package size tables | `npm run size` |
| README/website summaries | `npm run documentation:write` |

Review generated prose for em dashes and invented wording. If the generator
emits them, fix the generator.

## Before handoff

Read the new or edited copy out loud. Cut any sentence that does not name a
real behavior, limit, or file. Run `npm run check`.

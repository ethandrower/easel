<!-- easel:begin -->
## Easel design canvas

This repo uses [Easel](https://github.com/ethandrower/easel) for HTML prototypes. Design mocks live under `design-canvas/modules/<module>/<view>/` as standalone HTML, presented on a graph canvas (`npx easel`).

**Resolving comments** ("resolve the canvas comments" / "apply the design feedback"): open comments in each view's `comments.json` are a work queue. Each is pinned to an element via a CSS `selector` (with `tag`/`snippet`/`rect` context). Edit that view's `index.html` at the selector to satisfy the comment `text` (using the shared classes from `design-canvas/shared/ds.js`), then set the comment's `status` to `"resolved"`. See the `easel-resolve` skill/command.

**Creating a view** ("add a screen for X"): make `design-canvas/modules/<module>/<view>/` containing `index.html` (standalone, keep `<script src="../../../shared/ds.js"></script>`, built with the ds.js classes), `view.json` (`{ title, status, position:{x,y}, links:[] }`), and `comments.json` (`{ comments: [] }`). The running canvas picks it up and live-reloads — no build step. To link screens, either add `{ "to": "module/view", "label": "" }` to a view's `view.json` `links[]` (a documentation arrow) or give the source element `data-easel-nav="<relative href to target index.html>"` for real navigation (auto-shown as an edge).

**Sketches** (rough screens with no HTML yet): a view folder whose `view.json` has `"sketch": { "text": "..." }` and no `index.html`. The text is plain notes — `## Region` opens a region of the screen, `- item` says what lives there, `? question` is an open scoping question. You may edit the text to refine a sketch. When asked to design or build a sketch — or when `view.json` carries a `brief` (a promoted sketch) — create `index.html` from the notes: each `##` region becomes a section of the page and each `-` line an element in it; answer `?` questions sensibly and say what you chose. Then remove the `sketch` key (keep `brief`).

**Screen notes & iterations:** a view's `view.json` may carry `notes` — the author's storyboard annotations for that screen. Treat them as the spec when designing or revising it; don't rewrite them unless asked. A view whose `view.json` has `variant: { of, label }` is a lettered iteration of another screen: keep the same content and purpose but take a deliberately different design direction from its base.

**Styles:** the canvas library is synced from the app repo — `design-canvas/shared/library.json` lists the legal classes (regenerate with `npx easel styles sync`). Build screens ONLY with those classes plus plain Tailwind utilities. Never add `<style>` blocks, `style=""` attributes, or invented library-look-alike classes (a new `btn-*`/`badge-*`); if the library lacks something, use utilities and leave an HTML comment noting the gap. `npx easel styles lint` should come back clean for screens you touch.

Never introduce a build step — these are standalone files that live-reload. Full usage: `GUIDE.md` in the Easel repo.
<!-- easel:end -->

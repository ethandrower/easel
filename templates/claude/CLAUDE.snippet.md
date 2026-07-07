<!-- easel:begin -->
## Easel design canvas

This repo uses [Easel](https://github.com/ethandrower/easel) for HTML prototypes. Design mocks live under `design-canvas/modules/<module>/<view>/` as standalone HTML, presented on a graph canvas (`npx easel`).

**Resolving comments** ("resolve the canvas comments" / "apply the design feedback"): open comments in each view's `comments.json` are a work queue. Each is pinned to an element via a CSS `selector` (with `tag`/`snippet`/`rect` context). Edit that view's `index.html` at the selector to satisfy the comment `text` (using the shared classes from `design-canvas/shared/ds.js`), then set the comment's `status` to `"resolved"`. See the `easel-resolve` skill/command.

**Creating a view** ("add a screen for X"): make `design-canvas/modules/<module>/<view>/` containing `index.html` (standalone, keep `<script src="../../../shared/ds.js"></script>`, built with the ds.js classes), `view.json` (`{ title, status, position:{x,y}, links:[] }`), and `comments.json` (`{ comments: [] }`). The running canvas picks it up and live-reloads — no build step. To link screens, either add `{ "to": "module/view", "label": "" }` to a view's `view.json` `links[]` (a documentation arrow) or give the source element `data-easel-nav="<relative href to target index.html>"` for real navigation (auto-shown as an edge).

Never introduce a build step — these are standalone files that live-reload. Full usage: `GUIDE.md` in the Easel repo.
<!-- easel:end -->

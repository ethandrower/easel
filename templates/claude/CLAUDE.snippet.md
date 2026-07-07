<!-- easel:begin -->
## Easel design canvas

This repo uses [Easel](https://github.com/ethandrower/easel) for HTML prototypes. Design mocks live under `design-canvas/modules/<module>/<view>/` as standalone HTML, presented on a graph canvas (`npx easel`).

**When the user asks you to "resolve the canvas comments" / "apply the design feedback":** open comments in each view's `comments.json` are a work queue. Each is pinned to an element via a CSS `selector`. Edit that view's `index.html` at the selector to satisfy the comment `text` (using the shared classes from `design-canvas/shared/ds.js`), then set the comment's `status` to `"resolved"`. See the `easel-resolve` skill/command. Never introduce a build step — these are standalone files that live-reload.
<!-- easel:end -->

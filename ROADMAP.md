# Easel — roadmap

Open-core. The golden rule: **never cripple local.** Single-player is complete and free; the paid product is the collaboration + hosting layer that a team can't trivially self-host.

## v1 — OSS local loop (this repo) — DONE

- [x] Filesystem-as-source-of-truth model (modules/views/edges/status/comments)
- [x] Zero-dependency dev server: static + live-reload + tree/view/comments/insert API
- [x] Vanilla pan/zoom graph canvas with live prototype iframes + edges
- [x] Lean contextual rail: related links + element-pinned comments
- [x] `easel init` scaffolding + Claude Code glue (skill + command + CLAUDE.md)
- [x] Insert / duplicate / rename / delete views on the canvas
- [x] Draw edges by dragging between nodes; click an edge to label/delete
- [x] Inline comment composer (no blocking dialogs) + Copy Claude prompt
- [x] Status filter, module group backdrops, minimap, cross-canvas comment overview
- [x] Iframe virtualization (live near viewport, placeholders far out) for scale
- [x] Cross-platform live-reload (recursive watch + mtime-poll fallback for Linux)
- [x] Server API test suite (`npm test`)
- [x] Browser-verified end-to-end
- [x] Full-page focus mode + element-pinned commenting (canvas and focus)
- [x] Link mode: wire real navigation (`data-easel-nav`) + auto-derived edges from markup
- [x] Real click-through edges (standalone navigates; canvas flies; focus follows)
- [x] One editable "Prompt for Claude" modal per view (design context + open comments), reliable copy
- [x] Live-reload of the focus frame (watch Claude redesign a screen full-screen)

## v2 — OSS polish (next)

Now dogfooding on a real product canvas (citemed Evidence Cloud) — items get promoted here as real use demands them.

- [ ] npm publish — the `easel` name is TAKEN on npm (someone else's v0.2.6), so `npx easel` installs the wrong package. Publish under a scope (`@ethandrower/easel`) or pick a new name; until then, run from a checkout (`node <easel>/bin/cli.mjs`) or `npm link`. Fix the README quickstart when decided.
- [x] **Sketch mode v2 — Balsamiq wireframes** — `✎ sketch` / `S` drops a no-HTML frame edited as a real wireframe: palette of primitives (box/heading/text/button/input/select/checkbox/table/image/tabs), drag/resize/label, numbered **notes** pinned to elements with leader lines (drag ◉ to re-pin; smallest element under the drop wins). The Claude prompt serializes geometry + pinned notes; **promote keeps the wireframe**, and every screen gets focus-mode faces: ✏ wireframe ↔ design ↔ iterations. Prose sketches from v1 still render/edit as text cards.
- [x] **Storyboard notes** — an annotation strip under every design frame (`view.json.notes`), edited in place, fed to the screen's Claude prompt; promoted sketches land their text here.
- [x] **Iterations per view** — `iterate` copies a screen as a lettered sibling (`-b`, `-c`) tied to its base with a labeled edge; prompts instruct deliberate divergence. (*State* stacks — modal open / empty / error — still open below.)
- [x] **Style-library sync + lint** — `easel styles sync` pulls the host repo's Tailwind theme + component CSS into `shared/library.gen.*` + a class inventory the prompts use; `easel styles lint` flags inline styles, duplicates of library classes, library look-alikes, and repeated custom styles (`style-report.json`).
- [ ] State stacks per view (modal open, empty, error) as child nodes
- [ ] Module management in-UI (create/rename/recolor/reorder; delete module)
- [ ] Broken-edge warnings + a kanban (by-status) view toggle
- [ ] Export (static bundle / PDF of a board)
- [ ] Optional `ds.js` auto-detection for common setups (Tailwind, CSS vars)
- [ ] Group backdrops handle spatially-interleaved modules gracefully

## Cloud — hosted collaboration (separate, closed, paid SaaS)

The paid boundary — none of this weakens the free local tool:

- Realtime **multiplayer + presence** on a shared canvas
- Comment **assignment / threads / notifications**, review & approval workflows
- Cloud persistence + **shareable review links** (stakeholders view without cloning the repo)
- **SSO / teams / roles**
- **Hosted "apply comments" agent runner** — trigger Claude edits without a local CLI (the sharpest paid hook: local requires everyone to run Claude Code; hosted runs the agent for the whole team)

## Licensing / structure notes

- Core: **Apache-2.0** (permissive + patent grant → widest adoption).
- SaaS lives in a **separate proprietary repo** — the moat is the closed cloud code + hosting + brand, not a license clause.
- **Trademark the name** separately so forks can't ship under it.
- Require **DCO/CLA** on contributions from day one to keep relicensing/dual-licensing options open.

# Easel — roadmap

Open-core. The golden rule: **never cripple local.** Single-player is complete and free; the paid product is the collaboration + hosting layer that a team can't trivially self-host.

## v1 — OSS local loop (this repo)

- [x] Filesystem-as-source-of-truth model (modules/views/edges/status/comments)
- [x] Zero-dependency dev server: static + live-reload + tree/view/comments/insert API
- [x] Vanilla pan/zoom graph canvas with live prototype iframes + edges
- [x] Lean contextual rail: related links + element-pinned comments
- [x] `easel init` scaffolding + Claude Code glue (skill + command + CLAUDE.md)
- [ ] Verify the end-to-end loop on a real project (dogfood on citemed)
- [ ] Delete-view / rename-view flows; broken-edge warnings in the UI
- [ ] Draw edges by dragging between nodes (instead of editing view.json)

## v2 — OSS polish

- [ ] Variant/state stacks per view (modal open, empty, error) as child nodes
- [ ] Minimap + status filter/kanban view toggle
- [ ] Canvas virtualization (screenshot placeholders → hydrate on zoom) for 100+ screens
- [ ] Real click-through edges (a prototype button actually navigates to the linked view)
- [ ] Export (static bundle / PDF of a board)
- [ ] Optional `ds.js` auto-detection for common setups (Tailwind, CSS vars)

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

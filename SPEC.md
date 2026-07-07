# Easel — architecture spec

The agreed design, so the structure is documented and not just in chat history.

## Goals

- Standalone HTML/CSS/JS prototypes that **share the host project's styles**, with **no build step** required to view one.
- A **zoomable graph canvas** (the Figma "see every screen at once" property) where screens are **live, clickable** — better than static pictures.
- The **hard part**: a viewer to navigate between screens, annotate them, and modify them via Claude Code.
- **Design-only.** No connection to the running app, no route mirroring, no screenshot sync.
- **Drop into any repo.** Nothing citemed- or framework-specific in the tool.

## Non-goals (explicitly cut)

- Live iframes of the real app / production route mirroring.
- Syncing prototypes with what's actually coded.
- Any build/bundler in the tool itself.
- Auto-detecting the host's design system (v1 — you point `ds.js` at it by hand).

## Model — the filesystem is the source of truth

```
design-canvas/
├── canvas.config.json
├── shared/ds.js                    # zero-build shared design system
├── _template.html                  # scaffold for new views
└── modules/<module>/
    ├── module.json                 # { title, color, order }
    └── <view>/
        ├── index.html              # the prototype (self-contained)
        ├── view.json               # { title, status, position:{x,y}, links:[{to,label}] }
        ├── comments.json           # { comments:[{ id, selector, text, status }] }
        └── assets/
```

- **node** = a view folder; identity is its path `module/view`.
- **edge** = an entry in a view's `links[]`; **cross-module edges are allowed**; the user draws/manages them, no rules.
- **status** ∈ `idea | in-progress | in-review | approved` → node color + filtering.
- **comment** = element-pinned via CSS `selector`; kept in a **separate file** from metadata (clean queue for Claude, different write cadence). Incoming edges are derived (each view only declares its outgoing `links`).

## Two-part codebase

**The tool** (this repo — generic, published to npm):
```
bin/cli.mjs            # init | serve
src/server/serve.mjs   # zero-dep: static + SSE live-reload + tree/view/comments/insert API
src/viewer/            # vanilla JS canvas app — reads the tree, hardcodes nothing
templates/             # what `init` copies: design-canvas/ + the Claude glue
```

**The content** (scaffolded into the host repo): the `design-canvas/` tree above.

## Viewer

- **Layout:** each view rendered at a fixed frame (1200×780) at 1:1; the whole surface pans/zooms (`translate/scale`). Zoom out → overview; zoom in → interact with a live prototype. New views auto-layout by module row; positions are draggable and saved to `view.json`.
- **Rail (one lean, right side, contextual to the selected view):** header (title + status + module) · **Related** (incoming/outgoing edges, click to fly) · **Comments** (this view's pins; `+ add comment` → click an element to pin; click to highlight; double-click to resolve).
- **Interactions:** single-click node = select; double-click = fly to; wheel = zoom at cursor; drag background = pan; `jump to view` search; `+ view` inserts into the graph.

## The Claude loop (async, files-as-API)

1. Pin a comment in the viewer → written to that view's `comments.json` as `{ selector, text, status:"open" }`.
2. In Claude Code: *"resolve the open canvas comments."* The `easel-resolve` skill reads open comments, edits each view's `index.html` at the `selector`, sets `status:"resolved"`.
3. The server watches the tree and live-reloads the viewer.

No plugin, no MCP server — the shared files are the whole integration.

## Decisions locked

npm CLI · Claude glue = skill + command + `CLAUDE.md` block · tokens = one hand-pointed `ds.js` (simple) · viewer = vanilla, zero-dependency · layout = auto + draggable · edges = drawn links · granularity = full pages (variants later) · Apache-2.0 core.

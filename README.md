# ▲ Easel

**An infinite-canvas workbench for HTML prototypes — navigable as a graph, edited by Claude Code. Drop it into any repo.**

Design tools like Figma give you one magical thing you can't get from a folder of mockups: zoom out and see *every screen at once*, laid out and connected. Easel brings that to **real, standalone HTML/CSS** — prototypes that share your project's styles, live in your repo, and can be edited by Claude Code straight from the comments you pin on them.

> Status: early. The local, single-player tool is the open-source core. A hosted collaboration layer is a separate product.

## Quickstart

```bash
npx easel init      # scaffold design-canvas/ + the Claude Code glue into this repo
npx easel           # open the canvas at http://localhost:4321
```

Then:
1. **Design** — each screen is a standalone `index.html` under `design-canvas/modules/<module>/<view>/`, styled by a shared `ds.js` you point at your project's CSS.
2. **Navigate** — pan/zoom the graph, click a node to see its links and comments, double-click to fly to it.
3. **Annotate** — pin a comment to any element on a screen.
4. **Edit via Claude** — in Claude Code: *"resolve the open canvas comments."* It reads your pins, edits the HTML at each pinned element, and marks them resolved. The canvas live-reloads.

## How it works

The **filesystem is the source of truth** — no database, no central manifest:

```
design-canvas/
├── shared/ds.js                     # shared design tokens/CSS (point at your app's styles)
├── _template.html                   # every new view is cloned from this
└── modules/<module>/                # a module = a folder (module.json for title/color/order)
    └── <view>/                       # a view  = a subfolder
        ├── index.html               #   the standalone prototype
        ├── view.json                #   { title, status, position, links[] }
        ├── comments.json            #   element-pinned annotations = Claude's work queue
        └── assets/                  #   images/css custom to this view
```

- **Nodes** = view folders. **Edges** = each view's `links[]` (cross-module allowed — you draw them).
- **Status** (`idea → in-progress → in-review → approved`) colors each node.
- **Comments** are pinned to a CSS `selector`, so they survive layout changes and give Claude an exact edit target.

The viewer just scans this tree and renders the graph. Everything it writes — moved nodes, status changes, new comments, inserted views — goes straight back to these files, which is exactly what Claude Code reads and edits. **The files on disk are the whole API.**

## Sharing your project's styles

Open `design-canvas/shared/ds.js` and either point it at your real stylesheet:

```js
document.write('<link rel="stylesheet" href="/canvas/shared/your-app.css">');
```

or tweak the neutral default tokens it ships with. Change it once → every screen updates.

## Commands

| Command | What it does |
|---|---|
| `easel init` | Scaffold `design-canvas/` + install the Claude glue (`.claude/skills`, `.claude/commands`, a `CLAUDE.md` block) |
| `easel` / `easel serve` | Serve the canvas (`--canvas <dir>`, `--port <n>`) |

## License

Apache-2.0 (the open-source core). See [ROADMAP](ROADMAP.md) for what's local-and-free vs. the hosted collaboration product.

# Using Easel

A practical guide to building and managing prototypes. (For the architecture, see [SPEC.md](SPEC.md).)

Run `npx easel` in a repo that has a `design-canvas/` folder (create one with `npx easel init`), then open the printed URL.

## Tools & shortcuts

Top-left tool switcher — or keyboard:

| Key | Tool | What it does |
|---|---|---|
| `V` | **Pointer** | Pan, select, drag nodes, interact with prototypes |
| `C` | **Comment** | Click any element on any view to pin a comment there |
| `L` | **Link** | Click an element, then pick a target view to wire real navigation |

Also: `F` fit · `+`/`-` or **⌘/Ctrl `+`/`-`/`0`** zoom (the canvas, not the browser) · **hold `Space`** to grab-pan from anywhere, even over a design · `Esc` back to pointer / close panels · double-click a view (or ⛶) opens it **full screen**.

## Organizing the canvas

- **Module switcher** (toolbar dropdown) — isolate one module at a time; everything else (nodes, edges, backdrops, minimap) hides and the view fits to that module. Pick "all modules" to zoom back out to the whole product.
- **`T heading`** — click the button, then click the canvas to drop a big section heading (Figma-style). Enter commits; drag to move; hover → × to delete.
- **`🗒 note`** — same flow, but drops a post-it note for written annotations (e.g. instructions for engineers next to a screen). ⌘/Ctrl+Enter or click-away commits; notes support multiple lines.
- Labels live in `design-canvas/labels.json` and remember which module backdrop they sit in, so they follow it when you isolate a module.
- Every screen's frame is **border-colored by its status** (gray idea, amber in-progress, blue in-review, green approved), with a status chip in the title bar — approval state reads at a glance, and **clicking the chip** changes the status right on the frame.

## Creating views

A "view" is one screen. There are three ways to make one — they all produce the same thing: a folder `design-canvas/modules/<module>/<view>/` with `index.html`, `view.json`, `comments.json`.

1. **`+ view` button** — pick a module + title, optionally a parent to link from. If you also fill in **"What is this screen?"**, Easel copies a ready-to-paste **Claude design prompt** on create.
2. **⧉ Prompt for Claude** (rail button on any view) — opens an editable prompt with the view's context (file path, shared classes, links, siblings) and any open comments. Type what you want under "Additional instructions", copy, and paste into Claude Code; the view fills in and live-reloads.
3. **By hand / Claude Code** — just create the folder and the three files. The server sees it immediately and the canvas live-reloads. Minimal `view.json`:
   ```json
   { "title": "Profile", "status": "idea", "position": { "x": 80, "y": 80 }, "links": [] }
   ```

New views scaffold from `design-canvas/_template.html`. Give buttons/links stable `id`s so they're easy to wire and comment on.

Manage views from the rail: **rename** (folder id), **duplicate** (great for variants), **delete**. Use **⤢ arrange** to auto-lay-out the whole graph by its links when things get messy.

## Edges — the three kinds of link

Easel distinguishes *documentation* links (just a drawn arrow) from *real* navigation (the prototype actually goes there). Both show as arrows; real ones are drawn solid/accent, documentation ones gray.

1. **Drag-to-link (documentation).** In pointer mode, drag the **↗ handle** on a node's top-right onto another node. Records a plain edge in `view.json` `links[]`. Click the edge to **label or delete** it. Use this to sketch flow before it's wired.
2. **Link mode (real navigation).** Pick the **🔗 Link** tool, click a source element (e.g. a button), choose the target view. Easel writes a real `data-easel-nav` onto the element *and* records a `wired` edge. Now:
   - opened **standalone**, the prototype navigates for real;
   - on the **canvas**, clicking it flies to the target node (keeps the map coherent);
   - in **focus mode**, clicking it follows through to the target.
   > The element needs a stable `id` (or matching markup) to wire the click. If it can't, Easel still records the edge and tells you — add an `id` or ask Claude to wire it.
3. **Hand-authored (auto-derived).** Any `<a href="../other-view/index.html">` or `data-easel-nav` you (or Claude) write in the HTML is **automatically surfaced as an edge** — no drawing needed. This is how Claude-built navigation shows up on the canvas.

Wired/derived edges are edited by changing the HTML (Easel tells you when you click one); documentation edges are edited from the canvas.

**Dead clicks flash the hotspots.** Click anything on a prototype that has no wired action — on the canvas or in full-screen focus — and every element that *does* navigate flashes blue for a moment (Figma-style), so you can see instantly where the prototype is functional and where it isn't. Typing in inputs doesn't count as a dead click.

## Commenting (the feedback loop)

- Press `C` (or the 💬 tool), then click any element on any view — a comment pins to that element with rich context (selector, tag, current markup, on-screen box). Works on the canvas *and* in full-screen focus.
- **Click a pin** to read the comment, then **Resolve** or **Delete**.
- **☰ comments** (toolbar) lists every open comment across the whole canvas; click one to jump to it.
- Set a view's **status** (idea → in-progress → in-review → approved) by clicking the chip on its title bar, or from the rail.

## Handing feedback to Claude Code

- **⧉ Prompt for Claude** (per view, in the rail and the focus bar) or **⧉ resolve all** (toolbar) opens an editable prompt — each open comment with its selector, current markup, and location, plus the view's design context. Edit it if you like, then **⧉ Copy** (the text is pre-selected, so ⌘/Ctrl+C also works).
- Paste it into Claude Code. The shipped **`easel-resolve`** skill tells Claude to edit each `index.html` at the pinned selector and mark the comment resolved. The canvas live-reloads with the changes — if you keep a view open full-screen, it reloads there too, so you can watch the redesign land.

## The whole loop, end to end

1. `+ view` → describe it → paste the design prompt into Claude → screen appears.
2. `L` wire its buttons to other screens.
3. `C` drop feedback on anything that's off.
4. **⧉ Prompt for Claude** → copy → paste → Claude applies it → live-reload.
5. Flip the view to **approved** when it's done.

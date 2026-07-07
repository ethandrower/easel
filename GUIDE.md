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

Also: `F` fit · `+`/`-` zoom · `Esc` back to pointer / close panels · double-click a view (or ⛶) opens it **full screen**.

## Creating views

A "view" is one screen. There are three ways to make one — they all produce the same thing: a folder `design-canvas/modules/<module>/<view>/` with `index.html`, `view.json`, `comments.json`.

1. **`+ view` button** — pick a module + title, optionally a parent to link from. If you also fill in **"What is this screen?"**, Easel copies a ready-to-paste **Claude design prompt** on create.
2. **✨ Design this view** (rail button on any view) — describe the screen; copies the same context-rich prompt. Paste it into Claude Code and the view fills in and live-reloads.
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

## Commenting (the feedback loop)

- Press `C` (or the 💬 tool), then click any element on any view — a comment pins to that element with rich context (selector, tag, current markup, on-screen box). Works on the canvas *and* in full-screen focus.
- **Click a pin** to read the comment, then **Resolve** or **Delete**.
- **☰ comments** (toolbar) lists every open comment across the whole canvas; click one to jump to it.
- Set a view's **status** (idea → in-progress → in-review → approved) in the rail; filter by status with the toolbar chips.

## Handing feedback to Claude Code

- **⧉ Copy Claude prompt** (per view, in the rail/focus bar) or **⧉ resolve all** (toolbar) copies a precise, paste-ready instruction — each open comment with its selector, current markup, and location.
- Paste it into Claude Code. The shipped **`easel-resolve`** skill tells Claude to edit each `index.html` at the pinned selector and mark the comment resolved. The canvas live-reloads with the changes.

## The whole loop, end to end

1. `+ view` → describe it → paste the design prompt into Claude → screen appears.
2. `L` wire its buttons to other screens.
3. `C` drop feedback on anything that's off.
4. **Copy Claude prompt** → paste → Claude applies it → live-reload.
5. Flip the view to **approved** when it's done.

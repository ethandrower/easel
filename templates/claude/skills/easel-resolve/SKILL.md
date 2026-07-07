---
name: easel-resolve
description: Resolve open comments left on Easel design-canvas prototypes. Trigger when the user says "resolve the open canvas comments", "apply the easel comments", "address the design feedback on <view>", or refers to comments/pins left in the Easel viewer. Reads comments.json sidecars under design-canvas/modules/**, edits the referenced prototype HTML at the given CSS selector, and marks each comment resolved.
---

# Easel — resolve canvas comments

Easel prototypes live under `design-canvas/modules/<module>/<view>/`. Each view folder has:
- `index.html` — the standalone prototype (styled via `../../../shared/ds.js`)
- `view.json` — `{ title, status, position, links }`
- `comments.json` — `{ "comments": [ { id, text, status, selector, tag, elementText, snippet, rect } ] }`

A comment with `"status": "open"` is a unit of design feedback pinned to an element. Each open comment carries rich context to help you act precisely:
- `selector` — the CSS selector of the pinned element (your primary edit target)
- `tag` / `elementText` — the element's tag and its text, to disambiguate
- `snippet` — the element's markup at capture time
- `rect` — its on-screen box `{x,y,w,h}` (design location, not something to edit)

**Open comments are your work queue.**

## Procedure

1. **Find the work.** If the user named a view, scope to that folder; otherwise search all `design-canvas/modules/**/comments.json` for comments where `status != "resolved"`.
2. **For each open comment:**
   a. Open the view's `index.html`. Locate the element matched by `selector` (e.g. `#new-task`, `main > div:nth-of-type(2)`).
   b. Make the smallest change that satisfies the comment's `text`. Keep the shared `ds.js` classes (`.btn`, `.badge`, `.card`, `.field`, …) — don't introduce a parallel styling system.
   c. If the change moves/removes the pinned element, that's fine — the pin re-resolves against the selector on next load; update the selector in the comment if the element's identity changed.
3. **Mark it resolved.** Set that comment's `"status": "resolved"` in `comments.json`. Do not delete it — the history is useful.
4. **Report** a short list: view, what the comment asked, what you changed.

## Rules

- Edit only the prototype HTML and its view's `comments.json` / `view.json` / local `assets/`. Never touch another view to satisfy one comment.
- Don't run a build; these are standalone files. The running `easel` server live-reloads the viewer automatically after you save.
- If a comment is ambiguous, make the most reasonable interpretation and note the assumption in your report rather than skipping it.
- To add a NEW view a comment asks for, mirror the folder shape (`index.html` from `design-canvas/_template.html` + `view.json` + `comments.json`) and add a `link` to it from the parent view's `view.json`.

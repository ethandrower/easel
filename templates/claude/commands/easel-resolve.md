---
description: Apply open Easel canvas comments — edit the pinned prototype elements and mark them resolved.
---

Resolve the open comments left on the Easel design-canvas prototypes.

Scope: $ARGUMENTS (a view path like `tasks/task-list`, a module name, or empty for all views).

Follow the `easel-resolve` skill:
1. Find comments with `status != "resolved"` in `design-canvas/modules/**/comments.json` (scoped to $ARGUMENTS if given).
2. For each, edit the view's `index.html` at the comment's CSS `selector` to satisfy its `text`, using the shared `ds.js` component classes.
3. Set each handled comment's `status` to `"resolved"` (keep it — don't delete).
4. Report view · request · change for each.

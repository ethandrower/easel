/*
 * Easel shared design system — ZERO-BUILD, single source of truth for every screen.
 *
 * Each prototype includes exactly one line in its <head>:
 *     <script src="../../../shared/ds.js"></script>
 *
 * Edit THIS file to change the look of every screen at once. Two ways to use it:
 *
 *   A) Point at YOUR project's real stylesheet (recommended — makes prototypes
 *      look native). Uncomment and set the href below:
 *
 *        // document.write('<link rel="stylesheet" href="/canvas/shared/your-app.css">');
 *
 *      (Drop your compiled CSS in this shared/ folder, or reference any URL.)
 *
 *   B) Use the neutral default tokens below as a starting point and tweak them.
 */
(function () {
  // ---- OPTION A: your real stylesheet -------------------------------------
  // document.write('<link rel="stylesheet" href="/canvas/shared/your-app.css">');

  // ---- OPTION B: neutral default tokens + a few component classes ----------
  document.write('<link rel="preconnect" href="https://fonts.googleapis.com">');
  document.write('<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">');
  document.write(`<style>
    :root {
      --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --ink: #111827; --muted: #6b7280; --line: #e5e7eb; --bg: #f9fafb; --surface: #ffffff;
      --primary: #2563eb; --primary-weak: #eff6ff;
      --success: #16a34a; --success-weak: #ecfdf3;
      --warning: #d97706; --warning-weak: #fffbeb;
      --danger: #dc2626; --danger-weak: #fef2f2;
      --radius: 8px;
    }
    * { box-sizing: border-box; }
    html { font-family: var(--font); color: var(--ink); font-size: 14px; }
    body { margin: 0; background: var(--bg); }
    h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
    h2 { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
    a { color: var(--primary); text-decoration: none; }

    .btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600;
      padding: 8px 14px; border-radius: var(--radius); border: 1px solid var(--primary); background: var(--primary); color: #fff; cursor: pointer; }
    .btn.secondary { background: #fff; color: var(--ink); border-color: var(--line); }
    .btn.danger { background: var(--danger); border-color: var(--danger); }
    .btn.ghost { background: transparent; color: var(--primary); border-color: transparent; }

    .badge { display: inline-flex; align-items: center; font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px; }
    .badge.gray { background: #f3f4f6; color: #4b5563; }
    .badge.blue { background: var(--primary-weak); color: var(--primary); }
    .badge.green { background: var(--success-weak); color: var(--success); }
    .badge.amber { background: var(--warning-weak); color: var(--warning); }
    .badge.red { background: var(--danger-weak); color: var(--danger); }

    .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
    .field { display: block; margin-bottom: 14px; }
    .field > span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .field input, .field select, .field textarea { width: 100%; font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }

    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 12px; color: var(--muted); font-weight: 600; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    td { font-size: 14px; padding: 12px; border-bottom: 1px solid var(--line); }
    tr:hover td { background: #fafbfc; }

    .page { max-width: 1040px; margin: 0 auto; padding: 32px; }
    .row { display: flex; align-items: center; gap: 12px; }
    .between { justify-content: space-between; }
    .muted { color: var(--muted); }
  </style>`);
})();

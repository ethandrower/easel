#!/usr/bin/env node
/*
 * Easel CLI.
 *
 *   easel init            scaffold ./design-canvas + the Claude Code glue into this repo
 *   easel serve [--canvas <dir>] [--port <n>]   open the canvas in the browser
 *   easel styles          sync the style library from the repo, then lint the screens
 *   easel styles sync     pull tokens + component CSS from the repo sources into shared/
 *   easel styles lint     flag inline/duplicate/invented styles that don't belong
 *   easel (no args)       == serve
 */
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/serve.mjs';
import { syncStyles, lintStyles } from '../src/server/styles.mjs';

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CWD = process.cwd();

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return flags;
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (!fss.existsSync(d)) await fs.copyFile(s, d);
  }
}

async function cmdInit() {
  const canvasDst = path.join(CWD, 'design-canvas');
  if (fss.existsSync(canvasDst)) {
    console.log('• design-canvas/ already exists — leaving it untouched');
  } else {
    await copyDir(path.join(TOOL_ROOT, 'templates', 'design-canvas'), canvasDst);
    console.log('✓ created design-canvas/ (with an example "tasks" module)');
  }

  // Claude Code glue: skills + commands + a protocol block appended to CLAUDE.md
  const claudeSrc = path.join(TOOL_ROOT, 'templates', 'claude');
  await copyDir(path.join(claudeSrc, 'skills'), path.join(CWD, '.claude', 'skills'));
  await copyDir(path.join(claudeSrc, 'commands'), path.join(CWD, '.claude', 'commands'));
  console.log('✓ installed Claude Code glue (.claude/skills + .claude/commands)');

  const snippet = await fs.readFile(path.join(claudeSrc, 'CLAUDE.snippet.md'), 'utf8');
  const claudeMd = path.join(CWD, 'CLAUDE.md');
  const marker = '<!-- easel:begin -->';
  const current = fss.existsSync(claudeMd) ? await fs.readFile(claudeMd, 'utf8') : '';
  if (!current.includes(marker)) {
    await fs.writeFile(claudeMd, current + (current ? '\n\n' : '') + snippet);
    console.log('✓ appended the Easel protocol to CLAUDE.md');
  } else {
    console.log('• CLAUDE.md already has the Easel protocol');
  }

  console.log('\nNext:');
  console.log('  1) point design-canvas/shared/ds.js at your project\'s stylesheet (optional)');
  console.log('  2) npx easel            # open the canvas');
  console.log('  3) annotate a view, then tell Claude Code: "resolve the open canvas comments"\n');
}

async function cmdServe(flags) {
  const canvasRoot = path.resolve(CWD, flags.canvas || 'design-canvas');
  if (!fss.existsSync(canvasRoot)) {
    console.error(`No canvas at ${canvasRoot}. Run \`easel init\` first, or pass --canvas <dir>.`);
    process.exit(1);
  }
  await startServer({
    canvasRoot,
    viewerRoot: path.join(TOOL_ROOT, 'src', 'viewer'),
    port: Number(flags.port) || 4321,
  });
}

async function cmdStyles(sub, flags) {
  const canvasRoot = path.resolve(CWD, flags.canvas || 'design-canvas');
  if (!fss.existsSync(canvasRoot)) {
    console.error(`No canvas at ${canvasRoot}. Run \`easel init\` first, or pass --canvas <dir>.`);
    process.exit(1);
  }
  try {
    if (!sub || sub === 'sync') {
      const r = await syncStyles(canvasRoot);
      console.log(`✓ synced ${r.classes.length} library classes from ${r.sources.join(', ')}`);
      for (const [f, state] of Object.entries(r.files)) console.log(`  ${state === 'unchanged' ? '•' : '✓'} ${f} — ${state}`);
      if (r.stripped.length) console.log(`  • stripped build-time directives: ${[...new Set(r.stripped)].join('  ')}`);
      if (r.themeError) console.log(`  ⚠ tailwind theme skipped — ${r.themeError}`);
    }
    if (!sub || sub === 'lint') {
      const report = await lintStyles(canvasRoot);
      const n = report.findings.length;
      console.log(`${n ? '⚠' : '✓'} lint: ${n} finding${n === 1 ? '' : 's'} (full report: style-report.json in the canvas)`);
      for (const f of report.findings.slice(0, 30)) {
        if (f.type === 'duplicate-of-library') console.log(`  · [${f.view}] ${f.selector} duplicates ${f.duplicates} — use the library class instead`);
        else if (f.type === 'library-lookalike') console.log(`  · [${f.view}] class "${f.class}" looks like a library class but isn't in the synced library`);
        else if (f.type === 'inline-styles') console.log(`  · [${f.view}] ${f.rules} inline <style> rule(s) — lean on the library`);
        else if (f.type === 'style-attributes') console.log(`  · [${f.view}] ${f.count} style="" attribute(s)`);
        else if (f.type === 'repeated-custom-style') console.log(`  · "${f.decls.slice(0, 70)}" repeats across ${f.views.join(', ')} — candidate for the library`);
      }
      if (report.findings.length > 30) console.log(`  … ${report.findings.length - 30} more in style-report.json`);
    }
  } catch (e) {
    console.error('✗ ' + e.message);
    process.exit(1);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
if (cmd === 'init') cmdInit();
else if (cmd === 'styles') cmdStyles(rest.find((a) => !a.startsWith('--')) || null, flags);
else cmdServe(flags); // default + `serve`

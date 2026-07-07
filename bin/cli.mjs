#!/usr/bin/env node
/*
 * Easel CLI.
 *
 *   easel init            scaffold ./design-canvas + the Claude Code glue into this repo
 *   easel serve [--canvas <dir>] [--port <n>]   open the canvas in the browser
 *   easel (no args)       == serve
 */
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/serve.mjs';

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

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
if (cmd === 'init') cmdInit();
else cmdServe(flags); // default + `serve`

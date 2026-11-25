#!/usr/bin/env node
// Makes src/vendor/prosemirror.js: ProseMirror (https://prosemirror.net), the engine of the admin's
// long-text editor (src/admin/richtext.js), bundled into one module the browser loads as it is.
// The site stays without dependencies: this script is the only thing that installs anything, in a
// temporary folder, and only when the bundle has to change (a ProseMirror update, or a part the
// editor starts to use). It needs npm and the internet:
//
//   node scripts/vendor.mjs
//
// To update ProseMirror, change the versions below (npm view <package> version), run it, and try
// the editor (README, "The long-text editor").

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/vendor/prosemirror.js');

const PACKAGES = {
  'prosemirror-model': '1.25.13',
  'prosemirror-state': '1.4.4',
  'prosemirror-view': '1.44.0',
  'prosemirror-transform': '1.12.7',
  'prosemirror-commands': '1.7.2',
  'prosemirror-keymap': '1.2.3',
  'prosemirror-history': '1.5.2',
  'prosemirror-schema-list': '1.6.1',
  'prosemirror-inputrules': '1.7.0',
  'prosemirror-dropcursor': '1.8.4',
  'prosemirror-gapcursor': '1.4.1',
};
const ESBUILD = '0.28.2';

// What the editor imports. Anything else stays out of the bundle.
const ENTRY = `
export { Schema, DOMParser, Fragment, Slice } from 'prosemirror-model';
export { EditorState, Plugin, PluginKey, Selection, TextSelection, NodeSelection } from 'prosemirror-state';
export { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
export { baseKeymap, toggleMark, setBlockType, wrapIn, lift, chainCommands, exitCode } from 'prosemirror-commands';
export { keymap } from 'prosemirror-keymap';
export { history, undo, redo, undoDepth, redoDepth } from 'prosemirror-history';
export { wrapInList, splitListItem, liftListItem } from 'prosemirror-schema-list';
export { inputRules, wrappingInputRule, textblockTypeInputRule, smartQuotes, undoInputRule, InputRule } from 'prosemirror-inputrules';
export { dropCursor } from 'prosemirror-dropcursor';
export { gapCursor } from 'prosemirror-gapcursor';
`;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'llamalab-vendor-'));
try {
  const deps = { ...PACKAGES, esbuild: ESBUILD };
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: deps }, null, 2));
  await fs.writeFile(path.join(dir, 'entry.js'), ENTRY);
  console.log(`Installing ${Object.keys(deps).length} packages in ${dir}…`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--save-exact'], { cwd: dir, stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(dir, 'node_modules/esbuild/install.js')], { cwd: dir, stdio: 'inherit' });

  const require = createRequire(path.join(dir, 'package.json'));
  const { build } = require('esbuild');
  const result = await build({
    entryPoints: [path.join(dir, 'entry.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    legalComments: 'none',
    write: false,
  });

  // Every package's own version and copyright line, and the MIT terms once (they're the same).
  const installed = [];
  const owners = new Set();
  let terms = '';
  for (const name of [...Object.keys(PACKAGES), 'orderedmap', 'rope-sequence', 'w3c-keyname']) {
    const base = path.join(dir, 'node_modules', name);
    const pkg = JSON.parse(await fs.readFile(path.join(base, 'package.json'), 'utf8'));
    if (pkg.license !== 'MIT') throw new Error(`${name}: license ${pkg.license}, not MIT`);
    installed.push(`${name} ${pkg.version}`);
    const license = (await fs.readFile(path.join(base, 'LICENSE'), 'utf8')).trim();
    const [first, ...rest] = license.split('\n');
    owners.add(first.trim());
    if (!terms) terms = rest.join('\n').trim();
  }
  const header = [
    'ProseMirror, bundled by scripts/vendor.mjs for the admin\'s long-text editor. Don\'t edit by hand.',
    '',
    ...installed,
    '',
    ...owners,
    '',
    ...terms.split('\n'),
  ].map((line) => (line ? `// ${line}` : '//')).join('\n');

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, `${header}\n${result.outputFiles[0].text}`);
  const kb = (await fs.stat(OUT)).size / 1024;
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${kb.toFixed(0)} KB).`);
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}

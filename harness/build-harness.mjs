// Writes harness/index.html: every scene in examples/ mounted under the block sandbox's CSP.
// Open the file in a browser and watch the console for CSP violations.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { page } from './page.mjs';

const lib = readFileSync('dist/sketch.iife.js', 'utf8');
const scenes = readdirSync('examples').filter((f) => f.endsWith('.json'));

const body = scenes.map((f) => {
  const json = readFileSync(`examples/${f}`, 'utf8').replace(/<\//g, '<\\/');
  return `<h2 style="font:600 14px system-ui;opacity:.6;margin:32px 0 10px">${f}</h2>
<script type="text/sketch">${json}</script>`;
}).join('\n') + `
<script>PotionSketch.mount();</script>`;

writeFileSync('harness/index.html', page(lib, `<main style="max-width:760px;margin:0 auto">${body}</main>`, { padding: '8px 16px 48px' }));
console.log(`open harness/index.html (${scenes.length} scene${scenes.length === 1 ? '' : 's'})`);

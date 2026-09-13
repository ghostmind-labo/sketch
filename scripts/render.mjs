// Renders a scene to PNG in headless Chrome, under a strict, no-network CSP.
//
//   node scripts/render.mjs examples/navier-stokes.json            → renders/navier-stokes.png (finished board)
//   node scripts/render.mjs scene.json --at=1500,4000,end           → one PNG per moment
//   node scripts/render.mjs scene.json --width=700 --debug          → note-column width, item outlines
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { page } from '../harness/page.mjs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? true];
}));
const [scenePath] = args.filter((a) => !a.startsWith('--'));
if (!scenePath) {
  console.error('usage: node scripts/render.mjs <scene.json> [--at=ms,…,end] [--width=900] [--debug] [--out=dir]');
  process.exit(1);
}

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const lib = readFileSync('dist/sketch.iife.js', 'utf8');
const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
if (flags.debug) scene.debug = true;
const width = Number(flags.width ?? 900);
const moments = String(flags.at ?? 'end').split(',');
const outDir = resolve(String(flags.out ?? 'renders'));
mkdirSync(outDir, { recursive: true });

const name = basename(scenePath).replace(/\.json$/, '');
const tmp = join(tmpdir(), `sketch-render-${process.pid}.html`);

for (const at of moments) {
  const seek = at === 'end' ? 'b.duration' : String(Number(at));
  const body = `<div id="b"></div>
<script>
const scene = ${JSON.stringify(scene).replace(/</g, '\\u003c')};
const b = Sketch.board('#b', scene, { autoplay: false, controls: false });
b.seek(${seek});
document.title = 'duration:' + Math.round(b.duration);
</script>`;
  writeFileSync(tmp, page(lib, body, { background: 'transparent' }));
  const out = join(outDir, moments.length > 1 ? `${name}-${at}.png` : `${name}.png`);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${width},2400`, '--default-background-color=00000000',
    `--screenshot=${out}`, `file://${tmp}`,
  ], { stdio: 'ignore' });
  execFileSync('magick', [out, '-trim', '+repage', out]);
  console.log(out);
}
rmSync(tmp, { force: true });

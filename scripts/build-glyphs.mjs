// Turns single-stroke fonts into compact pen paths: src/glyphs.generated.ts.
//
// Latin text comes from EMS Felix (SIL OFL, an SVG font whose glyphs are open
// strokes, not outlines). Greek and maths symbols come from the Hershey sets in
// hersheytext.json, remapped to their real code points.
//
// Output units: 1000 = font size. Baseline at y=0, y grows downward (screen space),
// capital height is 700.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('hersheytext/package.json'));
const CAP = 700;

const round = (n) => Math.round(n);
const encode = (strokes) => strokes.map((s) => s.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')).join(';');

function parsePath(d) {
  const strokes = [];
  let cur = null;
  const tokens = d.match(/[ML]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  let cmd = 'M';
  for (let i = 0; i < tokens.length; ) {
    if (/^[ML]$/i.test(tokens[i])) { cmd = tokens[i++].toUpperCase(); continue; }
    const x = +tokens[i++], y = +tokens[i++];
    if (cmd === 'M') { cur = [[x, y]]; strokes.push(cur); cmd = 'L'; }
    else cur.push([x, y]);
  }
  return strokes.filter((s) => s.length > 1 || s.length === 1);
}

// --- EMS Felix (SVG font, y up, cap-height 500) -----------------------------
const unescape = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const svg = readFileSync(join(pkgDir, 'svg_fonts/EMSFelix.svg'), 'utf8');
const defaultAdv = +svg.match(/<font[^>]*horiz-adv-x="([\d.]+)"/)[1];
const felixCap = +svg.match(/cap-height="([\d.]+)"/)[1];
const fk = CAP / felixCap;
const glyphs = {};
for (const m of svg.matchAll(/<glyph([^>]*)\/>/g)) {
  const attrs = m[1];
  const u = attrs.match(/unicode="([^"]*)"/);
  if (!u) continue;
  const ch = unescape(u[1]);
  if ([...ch].length !== 1) continue;
  const adv = +(attrs.match(/horiz-adv-x="([\d.]+)"/)?.[1] ?? defaultAdv);
  const d = attrs.match(/ d="([^"]*)"/)?.[1] ?? '';
  const strokes = parsePath(d).map((s) => s.map(([x, y]) => [x * fk, -y * fk]));
  glyphs[ch] = [round(adv * fk), encode(strokes)];
}

// --- Hershey Greek + maths (y down, glyph centred on its "o" half-width) ------
const hershey = JSON.parse(readFileSync(join(pkgDir, 'hersheytext.json'), 'utf8'));

function hersheyGlyph(set, key, k, base) {
  const c = hershey[set].chars[key.charCodeAt(0) - 33];
  const strokes = [];
  for (const part of c.d.split('M').filter(Boolean)) {
    const nums = part.replace(/L/g, ' ').trim().split(/[\s,]+/).map(Number);
    const s = [];
    for (let i = 0; i < nums.length; i += 2) s.push([nums[i] * k, (nums[i + 1] - base) * k]);
    strokes.push(s);
  }
  // Hershey glyphs carry little side bearing; add a touch so they sit among Felix letters.
  const pad = 60;
  return [round(c.o * 2 * k + pad * 2), encode(strokes.map((s) => s.map(([x, y]) => [x + pad, y])))];
}

function metrics(set) {
  const h = hershey[set].chars['H'.charCodeAt(0) - 33] ?? hershey[set].chars['A'.charCodeAt(0) - 33];
  const ys = h.d.match(/-?\d+/g).map(Number).filter((_, i) => i % 2 === 1);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  return { k: CAP / (bottom - top), base: bottom };
}

const GREEK = {
  A: 'Α', B: 'Β', C: 'Χ', D: 'Δ', E: 'Ε', F: 'Φ', G: 'Γ', H: 'Η', I: 'Ι', K: 'Κ', L: 'Λ', M: 'Μ', N: 'Ν',
  O: 'Ο', P: 'Π', Q: 'Θ', R: 'Ρ', S: 'Σ', T: 'Τ', U: 'Υ', W: 'Ω', X: 'Ξ', Y: 'Ψ', Z: 'Ζ',
  a: 'α', b: 'β', c: 'χ', d: 'δ', e: 'ε', f: 'φ', g: 'γ', h: 'η', i: 'ι', k: 'κ', l: 'λ', m: 'μ', n: 'ν',
  o: 'ο', p: 'π', q: 'θ', r: 'ρ', s: 'σ', t: 'τ', u: 'υ', w: 'ω', x: 'ξ', y: 'ψ', z: 'ζ',
};
const MATH = {
  '!': '±', '"': '∓', '#': '×', '$': '⋅', '&': '≤', "'": '≥', ':': '∏', ';': '∑', '?': '≠', '@': '≡',
  '^': '∝', '_': '∞', b: '√', d: '⊂', e: '∪', f: '⊃', g: '∩', h: '∈',
  i: '→', j: '↑', k: '←', l: '↓', m: '∂', n: '∇', p: '∫', v: '∃', w: 'ℵ', x: '÷', y: '‖', z: '⊥', '|': '∠', '~': '∴',
};

const hersheyChars = new Set([...Object.values(GREEK), ...Object.values(MATH), 'ϑ']);
const g = metrics('greek');
for (const [key, ch] of Object.entries(GREEK)) glyphs[ch] = hersheyGlyph('greek', key, g.k, g.base);
glyphs['ϑ'] = glyphs['θ'];
const m = metrics('mathlow');
for (const [key, ch] of Object.entries(MATH)) glyphs[ch] = hersheyGlyph('mathlow', key, m.k, m.base);
glyphs['·'] = glyphs['·'] ?? glyphs['⋅'];
glyphs['−'] = glyphs['-'];

// ≈ is not in either set: two Felix tildes, stacked.
{
  const [adv, d] = glyphs['~'];
  const shift = (dy) => d.split(';').map((s) => s.split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number);
    return `${x},${y + dy}`;
  }).join(' ')).join(';');
  glyphs['≈'] = [adv, `${shift(-90)};${shift(90)}`];
}

// Felix sets capitals and digits wide ("1 3 0 B", "OpenA I"). Its lowercase advances are
// deliberately tighter than the ink (the letters lean into each other), so keep those and
// only trim a glyph whose advance or left bearing is loose.
for (const [ch, [adv, d]] of Object.entries(glyphs)) {
  if (!d || hersheyChars.has(ch)) continue;
  const strokes = d.split(';').map((s) => s.split(' ').map((p) => p.split(',').map(Number)));
  const xs = strokes.flat().map((p) => p[0]);
  const min = Math.min(...xs), max = Math.max(...xs);
  const shift = min > 110 ? 110 - min : 0;
  const tight = Math.min(adv + shift, max + shift + 110);
  glyphs[ch] = [round(Math.max(tight, max + shift - 40)), encode(strokes.map((s) => s.map(([x, y]) => [x + shift, y])))];
}
glyphs[' '] = [round(glyphs[' '][0] * 0.8), ''];

const body = Object.entries(glyphs)
  .map(([ch, [adv, d]]) => `${JSON.stringify(ch)}:[${adv},${JSON.stringify(d)}]`)
  .join(',\n');
writeFileSync(
  'src/glyphs.generated.ts',
  `// Generated by scripts/build-glyphs.mjs. Do not edit.\n` +
  `// Latin: EMS Felix (SIL Open Font License, fonts/OFL.txt). Greek and maths: Hershey fonts via hersheytext (MIT).\n` +
  `// [advance, strokes] — 1000 = font size, baseline y=0, y down. Strokes split on ';', points on ' '.\n` +
  `export const GLYPHS: Record<string, [number, string]> = {\n${body}\n};\n`,
);
console.log(`glyphs: ${Object.keys(glyphs).length}, ${(body.length / 1024).toFixed(1)} KB`);

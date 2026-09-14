// Turns single-stroke fonts into compact pen paths: src/glyphs.generated.ts.
//
// Latin text comes from SVG fonts whose glyphs are open strokes, not outlines: the EMS fonts
// (SIL OFL) and Hershey Sans. Greek and maths symbols come from the Hershey sets in
// hersheytext.json, remapped to their real code points and shared by every font.
//
// Output units: 1000 = font size. Baseline at y=0, y grows downward (screen space),
// capital height is 700.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('hersheytext/package.json'));
const CAP = 700;

/**
 * Name a scene uses → SVG font file in hersheytext/svg_fonts. Each font adds ~25 KB to the
 * bundle, so only what is offered ships. Candidates tried and left out for now: EMSFelix,
 * EMSReadabilityItalic, EMSTech, EMSNixish, EMSElfin, HersheySans1.
 */
const LATIN = {
  readability: 'EMSReadability',
};

const round = (n) => Math.round(n);
const encode = (strokes) => strokes.map((s) => s.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')).join(';');
const decode = (d) => d.split(';').map((s) => s.split(' ').map((p) => p.split(',').map(Number)));

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
  return strokes;
}

const unescape = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// --- Latin: an SVG font (y up) ------------------------------------------------
function latin(file) {
  const svg = readFileSync(join(pkgDir, `svg_fonts/${file}.svg`), 'utf8');
  const defaultAdv = +svg.match(/<font[^>]*horiz-adv-x="([\d.]+)"/)[1];
  const fk = CAP / +svg.match(/cap-height="([\d.]+)"/)[1];
  const glyphs = {};
  for (const m of svg.matchAll(/<glyph([^>]*)\/>/g)) {
    const attrs = m[1];
    const u = attrs.match(/unicode="([^"]*)"/);
    if (!u) continue;
    const ch = unescape(u[1]);
    if ([...ch].length !== 1) continue;
    const adv = +(attrs.match(/horiz-adv-x="([\d.]+)"/)?.[1] ?? defaultAdv);
    const d = attrs.match(/ d="([^"]*)"/)?.[1] ?? '';
    glyphs[ch] = [round(adv * fk), encode(parsePath(d).map((s) => s.map(([x, y]) => [x * fk, -y * fk])))];
  }

  // ≈ is in no set: two of this font's tildes, stacked.
  if (glyphs['~']?.[1]) {
    const [adv, d] = glyphs['~'];
    const shift = (dy) => encode(decode(d).map((s) => s.map(([x, y]) => [x, y + dy])));
    glyphs['≈'] = [adv, `${shift(-90)};${shift(90)}`];
  }
  if (glyphs['-']) glyphs['−'] = glyphs['-'];

  // Some fonts set capitals and digits wide ("1 3 0 B"); slanted ones set lowercase tighter than
  // the ink on purpose. Keep tight advances and only trim a loose advance or left bearing.
  for (const [ch, [adv, d]] of Object.entries(glyphs)) {
    if (!d) continue;
    const strokes = decode(d);
    const xs = strokes.flat().map((p) => p[0]);
    const min = Math.min(...xs), max = Math.max(...xs);
    const shift = min > 110 ? 110 - min : 0;
    const tight = Math.min(adv + shift, max + shift + 110);
    glyphs[ch] = [round(Math.max(tight, max + shift - 40)), encode(strokes.map((s) => s.map(([x, y]) => [x + shift, y])))];
  }
  glyphs[' '] = [round((glyphs[' ']?.[0] ?? 375) * 0.8), ''];
  return glyphs;
}

// --- Greek + maths: Hershey (y down, glyph centred on its "o" half-width) -----
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
  const pad = 60;
  return [round(c.o * 2 * k + pad * 2), encode(strokes.map((s) => s.map(([x, y]) => [x + pad, y])))];
}

function metrics(set) {
  const h = hershey[set].chars['H'.charCodeAt(0) - 33];
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
const MATH_KEYS = {
  '!': '±', '"': '∓', '#': '×', '$': '⋅', '&': '≤', "'": '≥', ':': '∏', ';': '∑', '?': '≠', '@': '≡',
  '^': '∝', '_': '∞', b: '√', d: '⊂', e: '∪', f: '⊃', g: '∩', h: '∈',
  i: '→', j: '↑', k: '←', l: '↓', m: '∂', n: '∇', p: '∫', v: '∃', w: 'ℵ', x: '÷', y: '‖', z: '⊥', '|': '∠', '~': '∴',
};

const math = {};
const g = metrics('greek');
for (const [key, ch] of Object.entries(GREEK)) math[ch] = hersheyGlyph('greek', key, g.k, g.base);
math['ϑ'] = math['θ'];
const m = metrics('mathlow');
for (const [key, ch] of Object.entries(MATH_KEYS)) math[ch] = hersheyGlyph('mathlow', key, m.k, m.base);
math['·'] = math['⋅'];

// --- output -----------------------------------------------------------------
const set = (glyphs) => `{\n${Object.entries(glyphs).map(([ch, [adv, d]]) => `${JSON.stringify(ch)}:[${adv},${JSON.stringify(d)}]`).join(',\n')}\n}`;
const fonts = Object.entries(LATIN).map(([name, file]) => [name, latin(file)]);

const out =
  `// Generated by scripts/build-glyphs.mjs. Do not edit.\n` +
  `// Latin: EMS fonts (SIL Open Font License, fonts/OFL.txt) and Hershey Sans. Greek and maths: Hershey fonts via hersheytext (MIT).\n` +
  `// [advance, strokes] — 1000 = font size, baseline y=0, y down. Strokes split on ';', points on ' '.\n` +
  `export type GlyphSet = Record<string, [number, string]>;\n\n` +
  `/** Greek and maths symbols, shared by every font. */\n` +
  `export const MATH: GlyphSet = ${set(math)};\n\n` +
  `export const FONTS: Record<string, GlyphSet> = {\n${fonts.map(([name, glyphs]) => `${JSON.stringify(name)}: ${set(glyphs)}`).join(',\n')}\n};\n`;
writeFileSync('src/glyphs.generated.ts', out);
console.log(`glyphs: maths ${Object.keys(math).length}; ${fonts.map(([n, gl]) => `${n} ${Object.keys(gl).length}`).join(', ')}; ${(out.length / 1024).toFixed(1)} KB`);

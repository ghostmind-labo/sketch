// Turns single-stroke fonts into compact pen paths: src/glyphs.generated.ts.
//
// Everything is contained in this repo — no network, no font packages. Latin text comes from
// EMS Readability (an SVG font whose glyphs are open strokes, SIL OFL) and from traced hands kept
// as JSON in src/fonts/. Greek and maths symbols come from the Hershey sets in hersheytext, with
// the rest composed here from strokes, and they are shared by every font.
//
// Output units: 1000 = font size. Baseline at y=0, y grows downward (screen space),
// capital height is 700.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('hersheytext/package.json'));
const CAP = 700;

/** Name a scene uses → SVG font file in hersheytext/svg_fonts. */
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

/** A hand traced from written sheets, stored in this repo as character -> [advance, strokes]. */
function traced(file) {
  const glyphs = JSON.parse(readFileSync(join('src/fonts', file), 'utf8'));
  if (!glyphs[' ']) glyphs[' '] = [300, ''];
  if (glyphs['-'] && !glyphs['−']) glyphs['−'] = glyphs['-'];
  return glyphs;
}

/** ≈ is in no sheet: two of this font's own tildes, stacked. */
function addApprox(glyphs) {
  if (!glyphs['~']?.[1] || glyphs['≈']) return;
  const [adv, d] = glyphs['~'];
  const shift = (dy) => encode(decode(d).map((s) => s.map(([x, y]) => [x, y + dy])));
  glyphs['≈'] = [adv, `${shift(-90)};${shift(90)}`];
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
  '^': '∝', '_': '∞', '`': '°', b: '√', d: '⊂', e: '∪', f: '⊃', g: '∩', h: '∈',
  i: '→', j: '↑', k: '←', l: '↓', m: '∂', n: '∇', p: '∫', v: '∃', w: 'ℵ', x: '÷', y: '‖', z: '⊥',
  '|': '∠', '~': '∴',
};

const math = {};
const g = metrics('greek');
for (const [key, ch] of Object.entries(GREEK)) math[ch] = hersheyGlyph('greek', key, g.k, g.base);
math['ϑ'] = math['θ'];
const m = metrics('mathlow');
for (const [key, ch] of Object.entries(MATH_KEYS)) math[ch] = hersheyGlyph('mathlow', key, m.k, m.base);
math['·'] = math['⋅'];
math['∥'] = math['‖'];

// --- Composed symbols --------------------------------------------------------
// Hershey has no set theory, logic, double arrows or blackboard bold. Rather than trace another
// font, build them from strokes: every one is a few lines, a circle, or an existing glyph with
// something added — deterministic, and they inherit the same weight as everything else.
const poly = (...points) => points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
const ring = (cx, cy, r, n = 24) =>
  poly(...Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]));
const glyph = (adv, ...strokes) => [adv, strokes.filter(Boolean).join(';')];
/** An existing symbol with extra strokes laid over it (∈ + slash = ∉). */
const over = (ch, ...strokes) => [math[ch][0], [math[ch][1], ...strokes].filter(Boolean).join(';')];
/** An existing symbol turned upside down about the maths axis (∴ → ∵, Α → ∀). */
function flipY(ch, axis = -350) {
  const [adv, d] = math[ch];
  return [adv, encode(decode(d).map((s) => s.map(([x, y]) => [x, 2 * axis - y])))];
}

const MID = -350;                     // the maths axis: where ×, +, − sit
const composed = {
  '¬': glyph(640, poly([110, -420], [560, -420], [560, -190])),
  '∧': glyph(620, poly([110, -60], [350, -640], [590, -60])),
  '∨': glyph(620, poly([110, -640], [350, -60], [590, -640])),
  '∘': glyph(420, ring(230, MID, 120)),
  '∅': glyph(640, ring(340, MID, 280), poly([120, -60], [560, -640])),
  '⊕': glyph(720, ring(360, MID, 300), poly([360, -650], [360, -50]), poly([60, MID], [660, MID])),
  '⊗': glyph(720, ring(360, MID, 300), poly([148, -562], [572, -138]), poly([148, -138], [572, -562])),
  '⊙': glyph(720, ring(360, MID, 300), ring(360, MID, 70)),
  '⇒': glyph(900, poly([110, -270], [700, -270]), poly([110, -430], [700, -430]), poly([620, -560], [820, -350], [620, -140])),
  '⇔': glyph(1000, poly([200, -270], [800, -270]), poly([200, -430], [800, -430]),
    poly([720, -560], [920, -350], [720, -140]), poly([280, -560], [80, -350], [280, -140])),
  '↔': glyph(900, poly([90, MID], [810, MID]), poly([700, -520], [820, MID], [700, -180]), poly([200, -520], [80, MID], [200, -180])),
  '↦': glyph(900, poly([110, -600], [110, -100]), poly([110, MID], [810, MID]), poly([660, -520], [820, MID], [660, -180])),
  '≅': glyph(760, poly([110, -540], [230, -600], [400, -480], [520, -540], [650, -600]), poly([110, -300], [650, -300]), poly([110, -160], [650, -160])),
  '≪': glyph(860, poly([420, -600], [110, MID], [420, -100]), poly([760, -600], [450, MID], [760, -100])),
  '≫': glyph(860, poly([110, -600], [420, MID], [110, -100]), poly([450, -600], [760, MID], [450, -100])),
  '⌈': glyph(400, poly([330, -760], [140, -760], [140, 60])),
  '⌉': glyph(400, poly([70, -760], [260, -760], [260, 60])),
  '⌊': glyph(400, poly([140, -760], [140, 60], [330, 60])),
  '⌋': glyph(400, poly([260, -760], [260, 60], [70, 60])),
  '⟨': glyph(400, poly([300, -760], [110, -350], [300, 60])),
  '⟩': glyph(400, poly([100, -760], [290, -350], [100, 60])),
  '…': glyph(900, poly([120, -40], [160, -40]), poly([430, -40], [470, -40]), poly([740, -40], [780, -40])),
};
Object.assign(math, composed);

// Negations and relatives, built from what now exists.
const slash = poly([120, -30], [560, -670]);
Object.assign(math, {
  '∉': over('∈', slash),
  '∄': over('∃', slash),
  '⊄': over('⊂', slash),
  '⊅': over('⊃', slash),
  '⊆': over('⊂', poly([110, 60], [620, 60])),
  '⊇': over('⊃', poly([110, 60], [620, 60])),
  '∵': flipY('∴'),
  '∀': flipY('Α', -350),
});

// Blackboard bold: the Latin capital with one stroke doubled — what a hand does on a board.
// The letters come from Hershey's sans set, not the Greek one: ℝ is an R, not a Ρ.
const fut = metrics('futural');
for (const [ch, letter, stem] of [['ℝ', 'R', 80], ['ℕ', 'N', 80], ['ℤ', 'Z', 150], ['ℚ', 'Q', 80], ['ℂ', 'C', 110]]) {
  const [adv, d] = hersheyGlyph('futural', letter, fut.k, fut.base);
  const xs = decode(d).flat().map((p) => p[0]);
  const x0 = Math.min(...xs);
  // C has no stem to double, so its bar sits inside the opening, as the printed glyph does.
  const bar = ch === 'ℂ'
    ? poly([x0 + stem, -520], [x0 + stem, -180])
    : poly([x0 + stem, -700], [x0 + stem, 0]);
  math[ch] = [adv + 40, [d, bar].join(';')];
}

// --- output -----------------------------------------------------------------
const set = (glyphs) => `{\n${Object.entries(glyphs).map(([ch, [adv, d]]) => `${JSON.stringify(ch)}:[${adv},${JSON.stringify(d)}]`).join(',\n')}\n}`;

const fonts = Object.entries(LATIN).map(([name, file]) => [name, latin(file)]);
for (const file of readdirSync('src/fonts').filter((f) => f.endsWith('.json')).sort()) {
  fonts.push([file.replace(/\.json$/, ''), traced(file)]);
}
for (const [, glyphs] of fonts) addApprox(glyphs);

const out =
  `// Generated by scripts/build-glyphs.mjs. Do not edit.\n` +
  `// Latin: EMS Readability (SIL Open Font License, fonts/OFL.txt) and the traced hands in src/fonts/.\n` +
  `// Greek and maths: Hershey fonts via hersheytext (MIT), plus symbols composed in the build.\n` +
  `// [advance, strokes] — 1000 = font size, baseline y=0, y down. Strokes split on ';', points on ' '.\n` +
  `export type GlyphSet = Record<string, [number, string]>;\n\n` +
  `/** Greek and maths symbols, shared by every font. */\n` +
  `export const MATH: GlyphSet = ${set(math)};\n\n` +
  `export const FONTS: Record<string, GlyphSet> = {\n${fonts.map(([name, glyphs]) => `${JSON.stringify(name)}: ${set(glyphs)}`).join(',\n')}\n};\n`;
writeFileSync('src/glyphs.generated.ts', out);
console.log(`glyphs: maths ${Object.keys(math).length}; ${fonts.map(([n, gl]) => `${n} ${Object.keys(gl).length}`).join(', ')}; ${(out.length / 1024).toFixed(1)} KB`);

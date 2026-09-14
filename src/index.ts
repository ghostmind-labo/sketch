// sketch — a scene description becomes a hand-written explainer board, either
// animated (written stroke by stroke) or static (the finished board).
//
// Everything is drawn as open pen strokes (single-line fonts, hand-built shapes), so every
// mark can be revealed along its own path, the way a pen writes it. The IIFE is self-contained
// so it runs under a strict CSP: no network, no workers, nothing touched until board() or
// mount() is called.
import { FONTS, MATH } from './glyphs.generated';
import { createScratch } from './sound';

export const version = '0.3.0';

/** Handwriting fonts a scene or text item can name. */
export const fonts = Object.keys(FONTS);
const DEFAULT_FONT = 'readability';
/**
 * How much each letter drifts in size, angle, height and spacing. 0 draws text and maths clean and
 * typeset-like; 1 gives a hand-written wobble. Annotations (circles, arrows, brackets) always wobble.
 */
const TEXT_WOBBLE = 0;

export type Pt = [number, number];
export interface Rect { x: number; y: number; w: number; h: number }
/** A point: [x, y], an item id ("eq" → nearest edge), an id with a side ("eq.bottom"), or { at, dx, dy }. */
export type Ref = string | Pt | { at: string; dx?: number; dy?: number };
/** What a mark wraps: an id, several ids (their union), or a literal rectangle. */
export type Target = string | string[] | Rect;
export type Side = 'top' | 'bottom' | 'left' | 'right';

interface Common {
  id?: string;
  color?: string;
  /** Stroke width in board units. */
  width?: number;
  /** Extra pause before this item starts, in ms. */
  wait?: number;
  /** Draw at the same time as the previous item instead of after it. */
  with?: 'prev';
  /** Pen speed multiplier for this item. */
  speed?: number;
}

export interface TextItem extends Common {
  type: 'text';
  /** Plain text plus light maths markup: ^{…} _{…} \frac{a}{b} \vec{v} \bar{x} \hat{x} \dot{x} \sqrt{x} \ul{x} \id{name}{…} and \alpha-style symbol names. */
  text: string;
  x?: number;
  y?: number;
  size?: number;
  /** Handwriting font for this item; defaults to the scene's. */
  font?: string;
  align?: 'left' | 'center' | 'right';
  below?: string;
  above?: string;
  rightOf?: string;
  leftOf?: string;
  gap?: number;
  dx?: number;
  dy?: number;
  maxWidth?: number;
  lineHeight?: number;
}
export interface ArrowItem extends Common {
  type: 'arrow';
  from: Ref;
  to: Ref;
  via?: Ref[];
  /** Sideways bow as a fraction of the arrow's length; negative bows the other way. */
  bend?: number;
  gap?: number;
  head?: 'end' | 'start' | 'both' | 'none';
}
export interface LineItem extends Common {
  type: 'line';
  points: Ref[];
  smooth?: boolean;
}
export interface MarkItem extends Common {
  type: 'circle' | 'box' | 'underline' | 'strike' | 'bracket' | 'brace';
  around?: Target;
  under?: Target;
  over?: Target;
  target?: Target;
  side?: Side;
  pad?: number;
  double?: boolean;
}
export interface PauseItem { type: 'pause'; ms: number }
export type Item = TextItem | ArrowItem | LineItem | MarkItem | PauseItem;

export interface Options {
  /** 'animation' writes the board stroke by stroke; 'static' shows the finished board. */
  mode: 'animation' | 'static';
  /** true: play at once. 'visible': play the first time the board scrolls into view. false: wait for a tap. */
  autoplay: boolean | 'visible';
  /** Play / scrub bar under an animated board. */
  controls: boolean;
  /** Animation: a stylus rides the tip of each stroke as it is written. */
  pencil: boolean;
  /** Animation: a synthesised writing sound that follows the pen; starts after the first tap or click. */
  sound: boolean;
}

export interface Scene extends Partial<Options> {
  width?: number;
  height?: number;
  padding?: number;
  /** Board colour; 'none' draws on the note itself and 'white' ink follows the note's text colour. */
  background?: string;
  color?: string;
  /** Handwriting font for all text: see `fonts`. */
  font?: string;
  /** Global playback speed multiplier. */
  speed?: number;
  seed?: number;
  /** Outline every item and label its id — for laying a scene out. */
  debug?: boolean;
  items: Item[];
}

export interface Board {
  el: HTMLElement;
  duration: number;
  readonly time: number;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  seek(ms: number): void;
  restart(): void;
  /** Whether the writing sound is on (always false when the scene has no sound). */
  readonly sound: boolean;
  setSound(on: boolean): void;
  destroy(): void;
}

export const colors: Record<string, string> = {
  white: '#f1f0ea', chalk: '#f1f0ea', yellow: '#f2ea72', lime: '#ddf27c', green: '#8fe07a',
  blue: '#8288ff', cyan: '#72d3ef', purple: '#b877ee', violet: '#b877ee', magenta: '#e06ade',
  pink: '#f27dc9', red: '#f45b73', orange: '#f5a04c', grey: '#9d9d9d', gray: '#9d9d9d',
};

// ─── randomness ────────────────────────────────────────────────────────────────

interface Rng { r(): number; n(spread: number): number }

function rng(seed: number): Rng {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { r, n: (s) => (r() * 2 - 1) * s };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ─── geometry helpers ─────────────────────────────────────────────────────────

const last = <T>(a: T[]): T => a[a.length - 1];
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (u: number) => u * u * (3 - 2 * u);

function polyLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

function inkRect(strokes: { pts: Pt[] }[]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s.pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function union(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A line as a hand draws it: a faint bow and a little tremor. */
function handLine(a: Pt, b: Pt, R: Rng, n = 6): Pt[] {
  const len = dist(a, b);
  const nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
  const sag = R.n(len * 0.018);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = sag * Math.sin(Math.PI * t) + (i && i < n ? R.n(len * 0.002) : 0);
    const p = lerp(a, b, t);
    out.push([p[0] + nx * off, p[1] + ny * off]);
  }
  return out;
}

function quad(a: Pt, c: Pt, b: Pt, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

function catmull(points: Pt[], per = 10): Pt[] {
  if (points.length < 3) return points.length === 2 ? quad(points[0], lerp(points[0], points[1], 0.5), points[1], per) : points;
  const out: Pt[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
    for (let j = 1; j <= per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      const f = (k: 0 | 1) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  return out;
}

/** SVG path through the points: Catmull-Rom curves, broken at sharp corners so a V stays a V. */
function pathD(pts: Pt[], smooth: boolean): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  if (pts.length === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}l0.01 0`;
  if (!smooth || pts.length < 3) return 'M' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L');
  const runs: Pt[][] = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    last(runs).push(pts[i]);
    if (i < pts.length - 1) {
      const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      const b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      let turn = Math.abs(b - a);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > 1.1) runs.push([pts[i]]);
    }
  }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (const r of runs) {
    if (r.length < 3) { d += r.slice(1).map((p) => `L${f(p[0])} ${f(p[1])}`).join(''); continue; }
    for (let i = 0; i < r.length - 1; i++) {
      const p0 = r[i - 1] ?? r[i], p1 = r[i], p2 = r[i + 1], p3 = r[i + 2] ?? p2;
      const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
    }
  }
  return d;
}

// ─── glyphs ───────────────────────────────────────────────────────────────────

interface Glyph { adv: number; strokes: Pt[][]; top: number; bottom: number }
const glyphCache = new Map<string, Glyph | null>();

function glyph(c: string, font: string): Glyph | null {
  const key = font + '\u0000' + c;
  if (glyphCache.has(key)) return glyphCache.get(key)!;
  const raw = FONTS[font]?.[c] ?? MATH[c];
  let g: Glyph | null = null;
  if (raw) {
    const strokes = raw[1] ? raw[1].split(';').map((s) => s.split(' ').map((p) => p.split(',').map(Number) as Pt)) : [];
    let top = 0, bottom = 0;
    for (const s of strokes) for (const [, y] of s) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    g = { adv: raw[0], strokes, top, bottom };
  }
  glyphCache.set(key, g);
  return g;
}

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  partial: '∂', nabla: '∇', int: '∫', sum: '∑', prod: '∏', infty: '∞', pm: '±', mp: '∓', times: '×', cdot: '⋅',
  div: '÷', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', equiv: '≡', approx: '≈', propto: '∝',
  to: '→', rightarrow: '→', leftarrow: '←', uparrow: '↑', downarrow: '↓', in: '∈', subset: '⊂', supset: '⊃',
  cup: '∪', cap: '∩', exists: '∃', aleph: 'ℵ', therefore: '∴', perp: '⊥', angle: '∠', deg: '°', parallel: '‖',
};

// ─── text markup ──────────────────────────────────────────────────────────────

type Node =
  | { k: 'ch'; c: string }
  | { k: 'sup' | 'sub'; n: Node[] }
  | { k: 'frac'; a: Node[]; b: Node[] }
  | { k: 'deco'; d: string; n: Node[] }
  | { k: 'mark'; name: string; n: Node[] }
  | { k: 'nl' };

const DECOS = ['vec', 'bar', 'hat', 'dot', 'sqrt', 'ul'];
// Written as the plain word, as on a board: \sin(x) → sin(x).
const FUNCTIONS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'mod'];

function parse(src: string): Node[] {
  let i = 0;
  const char = (): string => { const c = String.fromCodePoint(src.codePointAt(i)!); i += c.length; return c; };
  const arg = (): Node[] => {
    if (src[i] === '{') { i++; const n = seq('}'); i++; return n; }
    if (i >= src.length) return [];
    if (src[i] === '\\') return seq(undefined, 1);
    return [{ k: 'ch', c: char() }];
  };
  function seq(end?: string, limit = Infinity): Node[] {
    const out: Node[] = [];
    while (i < src.length && src[i] !== end && out.length < limit) {
      const c = src[i];
      if (c === '^' || c === '_') { i++; out.push({ k: c === '^' ? 'sup' : 'sub', n: arg() }); }
      else if (c === '\n') { i++; out.push({ k: 'nl' }); }
      else if (c === '\\') {
        const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
        if (!m) { i++; out.push({ k: 'ch', c: i < src.length ? char() : '\\' }); continue; }
        i += m[0].length;
        const name = m[1];
        if (name === 'frac') { const a = arg(); out.push({ k: 'frac', a, b: arg() }); }
        else if (DECOS.includes(name)) out.push({ k: 'deco', d: name, n: arg() });
        else if (name === 'id') {
          const label = arg().map((n) => (n.k === 'ch' ? n.c : '')).join('');
          out.push({ k: 'mark', name: label, n: arg() });
        } else if (SYMBOLS[name]) {
          out.push({ k: 'ch', c: SYMBOLS[name] });
          if (src[i] === ' ') i++;
        } else if (FUNCTIONS.includes(name)) {
          for (const ch of name) out.push({ k: 'ch', c: ch });
        } else for (const ch of '\\' + name) out.push({ k: 'ch', c: ch });
      } else out.push({ k: 'ch', c: char() });
    }
    return out;
  }
  return seq();
}

// ─── handwriting layout ───────────────────────────────────────────────────────

interface GS { pts: Pt[]; lift: number }
interface Box { s: GS[]; w: number; asc: number; desc: number; marks: [string, Rect][] }
interface Hand { R: Rng; font: string; wob: number; phase: number; amp: number; wl: number }

const LIFT = { stroke: 35, letter: 70, word: 190 };
const emptyBox = (): Box => ({ s: [], w: 0, asc: 0, desc: 0, marks: [] });

function place(into: Box, b: Box, dx: number, dy: number, lift?: number) {
  const start = into.s.length;
  for (const st of b.s) into.s.push({ lift: st.lift, pts: st.pts.map(([x, y]) => [x + dx, y + dy] as Pt) });
  for (const [n, r] of b.marks) into.marks.push([n, { ...r, x: r.x + dx, y: r.y + dy }]);
  into.asc = Math.max(into.asc, b.asc - dy);
  into.desc = Math.max(into.desc, b.desc + dy);
  if (lift !== undefined && into.s[start]) into.s[start].lift = Math.max(into.s[start].lift, lift);
}

function layout(nodes: Node[], size: number, H: Hand, x0 = 0): Box {
  const box = emptyBox();
  const R = H.R;
  let x = 0;
  let lift = LIFT.letter;
  for (const nd of nodes) {
    if (nd.k === 'ch') {
      if (nd.c === ' ' || nd.c === '\t') {
        x += (glyph(' ', H.font)?.adv ?? 300) * (size / 1000) * (1 + R.n(0.18 * H.wob));
        lift = LIFT.word;
        continue;
      }
      const g = glyph(nd.c, H.font) ?? glyph('?', H.font)!;
      // With wobble, each letter is written a little differently: size, angle, height and spacing drift.
      const k = (size / 1000) * (1 + R.n(0.04 * H.wob));
      const rot = R.n(0.045 * H.wob);
      const cx = (g.adv * k) / 2, cy = -0.32 * size;
      const dy = H.amp * Math.sin(((x0 + x) / H.wl) * 2 * Math.PI + H.phase) + R.n(0.014 * size * H.wob);
      const cos = Math.cos(rot), sin = Math.sin(rot);
      g.strokes.forEach((st, si) => {
        const ox = R.n(0.009 * size * H.wob), oy = R.n(0.009 * size * H.wob);
        let pts = st.map(([px, py]) => {
          const X = px * k - cx, Y = py * k - cy;
          return [x + cx + X * cos - Y * sin + ox, cy + X * sin + Y * cos + dy + oy] as Pt;
        });
        if (pts.length === 1) pts = [pts[0], [pts[0][0] + 0.02 * size, pts[0][1] + 0.01 * size]];
        box.s.push({ pts, lift: si === 0 ? lift : LIFT.stroke });
      });
      if (g.strokes.length) lift = LIFT.letter;
      box.asc = Math.max(box.asc, -g.top * k - dy);
      box.desc = Math.max(box.desc, g.bottom * k + dy);
      x += g.adv * k * (1 + R.n(0.035 * H.wob));
    } else if (nd.k === 'sup' || nd.k === 'sub') {
      const b = layout(nd.n, size * 0.62, H, x0 + x);
      place(box, b, x + 0.02 * size, nd.k === 'sup' ? -0.44 * size : 0.2 * size, lift);
      x += b.w + 0.06 * size;
      lift = LIFT.letter;
    } else if (nd.k === 'frac') {
      const s2 = size * 0.78;
      const a = layout(nd.a, s2, H, x0 + x), b = layout(nd.b, s2, H, x0 + x);
      const w = Math.max(a.w, b.w) + 0.28 * size;
      const axis = -0.3 * size;
      place(box, a, x + (w - a.w) / 2, axis - 0.14 * size - Math.max(a.desc, 0.02 * size), lift);
      const barA: Pt = [x + 0.04 * size, axis + R.n(0.02 * size * H.wob)], barB: Pt = [x + w - 0.04 * size, axis + R.n(0.02 * size * H.wob)];
      box.s.push({ pts: H.wob ? handLine(barA, barB, R, 4) : [barA, barB], lift: LIFT.letter });
      place(box, b, x + (w - b.w) / 2, axis + 0.18 * size + Math.max(b.asc, 0.5 * s2));
      x += w + 0.06 * size;
      lift = LIFT.letter;
    } else if (nd.k === 'deco') {
      const start = box.s.length;
      if (nd.d === 'sqrt') {
        const pad = 0.6 * size;
        const c = layout(nd.n, size, H, x0 + x + pad);
        const yTop = -Math.max(c.asc, 0.55 * size) - 0.14 * size;
        const end = x + pad + c.w + 0.08 * size;
        box.s.push({
          pts: [[x, -0.26 * size], [x + 0.13 * size, -0.34 * size], [x + 0.3 * size, 0.05 * size], [x + 0.52 * size, yTop], [end, yTop + R.n(0.03 * size * H.wob)]],
          lift,
        });
        place(box, c, x + pad, 0);
        box.asc = Math.max(box.asc, -yTop + 0.03 * size);
        x = end + 0.06 * size;
      } else {
        const c = layout(nd.n, size, H, x0 + x);
        place(box, c, x, 0, lift);
        const x1 = x + 0.03 * size, x2 = x + Math.max(c.w, 0.42 * size);
        const y = nd.d === 'ul' ? Math.max(c.desc, 0.08 * size) + 0.1 * size : -Math.max(c.asc, 0.5 * size) - 0.14 * size;
        if (nd.d === 'hat') {
          const m = (x1 + x2) / 2;
          box.s.push({ pts: [[m - 0.15 * size, y + 0.05 * size], [m, y - 0.1 * size], [m + 0.15 * size, y + 0.05 * size]], lift: LIFT.letter });
        } else if (nd.d === 'dot') {
          const m = (x1 + x2) / 2;
          box.s.push({ pts: [[m, y], [m + 0.025 * size, y + 0.01 * size]], lift: LIFT.letter });
        } else {
          const lineEnd: Pt = [x2, y + R.n(0.025 * size * H.wob)];
          const line: Pt[] = H.wob ? handLine([x1, y], lineEnd, R, 4) : [[x1, y], lineEnd];
          box.s.push({ pts: line, lift: LIFT.letter });
          if (nd.d === 'vec') {
            const e = last(line), hs = 0.13 * size;
            box.s.push({ pts: [[e[0] - hs, e[1] - hs * 0.62], e, [e[0] - hs, e[1] + hs * 0.62]], lift: LIFT.stroke });
          }
        }
        box.asc = Math.max(box.asc, -y + 0.12 * size);
        x += c.w;
      }
      if (box.s[start]) box.s[start].lift = Math.max(box.s[start].lift, lift);
      lift = LIFT.letter;
    } else if (nd.k === 'mark') {
      const start = box.s.length;
      const c = layout(nd.n, size, H, x0 + x);
      place(box, c, x, 0, lift);
      box.marks.push([nd.name, inkRect(box.s.slice(start)) ?? { x, y: -0.7 * size, w: c.w, h: 0.7 * size }]);
      x += c.w;
      lift = LIFT.letter;
    }
  }
  box.w = x;
  return box;
}

// ─── scene compilation ────────────────────────────────────────────────────────

interface DrawStroke {
  pts: Pt[];
  color: string;
  width: number;
  lift: number;
  item: number;
  pen: number;
  len: number;
  t0: number;
  dur: number;
}

const SIDES = ['top', 'bottom', 'left', 'right', 'center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const PEN_TEXT = 620, PEN_SHAPE = 1050;

function compile(scene: Scene) {
  const W = scene.width ?? 1000;
  const reg = new Map<string, Rect>();
  const debug: [string, Rect][] = [];
  const perItem: { strokes: Omit<DrawStroke, 't0' | 'dur'>[]; item: Item }[] = [];
  const bgNone = scene.background === 'none';
  const baseColor = scene.color ?? 'white';
  const colorOf = (c?: string) => {
    const name = c ?? baseColor;
    if (bgNone && (name === 'white' || name === 'chalk')) return 'currentColor';
    return colors[name] ?? name;
  };

  const rectOf = (t: Target): Rect => {
    if (Array.isArray(t)) return union(t.map(rectOf));
    if (typeof t !== 'string') return t;
    const r = reg.get(t);
    if (!r) throw new Error(`nothing with id "${t}" has been drawn yet`);
    return r;
  };

  const sidePoint = (r: Rect, side: string, gap: number): Pt => {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const L = r.x - gap, T = r.y - gap, Rt = r.x + r.w + gap, B = r.y + r.h + gap;
    switch (side) {
      case 'top': return [cx, T];
      case 'bottom': return [cx, B];
      case 'left': return [L, cy];
      case 'right': return [Rt, cy];
      case 'topLeft': return [L, T];
      case 'topRight': return [Rt, T];
      case 'bottomLeft': return [L, B];
      case 'bottomRight': return [Rt, B];
      default: return [cx, cy];
    }
  };

  const boundary = (r: Rect, toward: Pt, gap: number): Pt => {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const dx = toward[0] - cx, dy = toward[1] - cy;
    if (!dx && !dy) return [cx, r.y + r.h + gap];
    const t = Math.min(dx ? (r.w / 2 + gap) / Math.abs(dx) : Infinity, dy ? (r.h / 2 + gap) / Math.abs(dy) : Infinity);
    return [cx + dx * t, cy + dy * t];
  };

  /** Resolves a Ref. With `toward`, a bare id lands on its edge facing that point. */
  const point = (ref: Ref, toward: Pt | null, gap: number): Pt => {
    if (Array.isArray(ref)) return ref;
    let s: string, dx = 0, dy = 0;
    if (typeof ref === 'object') { s = ref.at; dx = ref.dx ?? 0; dy = ref.dy ?? 0; } else s = ref;
    let p: Pt;
    const exact = reg.get(s);
    if (exact) p = toward ? boundary(exact, toward, gap) : [exact.x + exact.w / 2, exact.y + exact.h / 2];
    else {
      const dot = s.lastIndexOf('.');
      const base = dot > 0 ? reg.get(s.slice(0, dot)) : undefined;
      const side = s.slice(dot + 1);
      if (!base || !SIDES.includes(side)) throw new Error(`can't find "${s}" — use an id drawn earlier, optionally with .top .bottom .left .right .center or a corner`);
      p = sidePoint(base, side, gap);
    }
    return [p[0] + dx, p[1] + dy];
  };

  scene.items.forEach((item, index) => {
    const R = rng(hash(`${scene.seed ?? 0}:${index}:${JSON.stringify(item)}`));
    const strokes: Omit<DrawStroke, 't0' | 'dur'>[] = [];
    const add = (pts: Pt[], lift: number, c: Common, width: number, pen: number) =>
      strokes.push({ pts, lift, color: colorOf(c.color), width: c.width ?? width, item: index, pen: pen * (c.speed ?? 1), len: polyLength(pts) });

    try {
      if (item.type === 'pause') { perItem.push({ strokes, item }); return; }

      if (item.type === 'text') {
        const size = item.size ?? 32;
        const font = item.font ?? scene.font ?? DEFAULT_FONT;
        if (!FONTS[font]) throw new Error(`unknown font "${font}" — use one of: ${fonts.join(', ')}`);
        const nodes = parse(item.text);
        const lines: Node[][] = [[]];
        for (const n of nodes) n.k === 'nl' ? lines.push([]) : last(lines).push(n);
        const lh = (item.lineHeight ?? 1.45) * size;
        const space = (glyph(' ', font)?.adv ?? 300) * (size / 1000);
        const boxes: Box[] = [];
        for (const ln of lines) {
          const H: Hand = { R, font, wob: TEXT_WOBBLE, phase: R.r() * 6.283, amp: 0.022 * size * TEXT_WOBBLE, wl: 8 * size };
          if (!item.maxWidth) { boxes.push(layout(ln, size, H)); continue; }
          const words: Node[][] = [[]];
          for (const n of ln) (n.k === 'ch' && n.c === ' ') ? words.push([]) : last(words).push(n);
          let cur = emptyBox(), x = 0;
          for (const w of words) {
            if (!w.length) continue;
            const b = layout(w, size, H, x);
            if (x > 0 && x + b.w > item.maxWidth) { boxes.push(cur); cur = emptyBox(); x = 0; }
            place(cur, b, x, 0, x > 0 ? LIFT.word : undefined);
            x += b.w + space * (1 + R.n(0.15 * TEXT_WOBBLE));
            cur.w = x - space;
          }
          boxes.push(cur);
        }
        const blockW = Math.max(0, ...boxes.map((b) => b.w));
        const asc = 0.78 * size;
        const blockH = asc + (boxes.length - 1) * lh + 0.28 * size;
        let align = item.align ?? 'left';
        let x = item.x, y = item.y;
        const gap = item.gap ?? 0.5 * size;
        const rel = item.below ?? item.above;
        if (rel) {
          const r = rectOf(rel);
          y = item.below ? r.y + r.h + gap : r.y - gap - blockH;
          if (x === undefined) x = align === 'center' ? r.x + r.w / 2 : align === 'right' ? r.x + r.w : r.x;
        }
        const side = item.rightOf ?? item.leftOf;
        if (side) {
          const r = rectOf(side);
          if (item.rightOf) { x = r.x + r.w + gap; align = 'left'; } else { x = r.x - gap; align = 'right'; }
          if (y === undefined) y = r.y + r.h / 2 - blockH / 2 + 0.08 * size;
        }
        x = (x ?? 40) + (item.dx ?? 0);
        y = (y ?? 40) + (item.dy ?? 0);
        const tilt = R.n(0.007 * TEXT_WOBBLE);
        const width = item.width ?? clamp(size * 0.07, 1.4, 6);
        const all: GS[] = [];
        boxes.forEach((b, j) => {
          const lx = align === 'center' ? x! - b.w / 2 : align === 'right' ? x! - b.w : x!;
          const by = y! + asc + j * lh;
          const tr = ([px, py]: Pt): Pt => [lx + px - py * tilt, by + py + px * tilt];
          b.s.forEach((s, si) => {
            const lift = si === 0 && j > 0 ? LIFT.word * 1.6 : s.lift;
            all.push({ pts: s.pts.map(tr), lift });
            add(last(all).pts, lift, item, width, PEN_TEXT);
          });
          for (const [name, r] of b.marks) {
            const a = tr([r.x, r.y]), c = tr([r.x + r.w, r.y + r.h]);
            const mr = { x: a[0], y: a[1], w: c[0] - a[0], h: c[1] - a[1] };
            reg.set(item.id ? `${item.id}.${name}` : name, mr);
            debug.push([item.id ? `${item.id}.${name}` : name, mr]);
          }
        });
        const ink = inkRect(all) ?? { x: x!, y: y!, w: blockW, h: blockH };
        if (item.id) { reg.set(item.id, ink); debug.push([item.id, ink]); }
      } else if (item.type === 'arrow') {
        const gap = item.gap ?? 10;
        const via = item.via ?? [];
        const rough = (r: Ref): Pt => point(r, null, 0);
        const firstToward = via.length ? rough(via[0]) : rough(item.to);
        const A = point(item.from, firstToward, gap);
        const viaPts = via.map((v) => rough(v));
        const B = point(item.to, viaPts.length ? last(viaPts) : A, gap);
        const len = dist(A, B);
        let shaft: Pt[];
        if (viaPts.length) shaft = catmull([A, ...viaPts, B], 12).map(([px, py]) => [px + R.n(0.6), py + R.n(0.6)] as Pt);
        else {
          const bend = item.bend ?? R.n(0.05);
          const nx = -(B[1] - A[1]) / (len || 1), ny = (B[0] - A[0]) / (len || 1);
          const mid = lerp(A, B, 0.5);
          shaft = quad(A, [mid[0] + nx * bend * len, mid[1] + ny * bend * len], B, 18);
        }
        const width = 2.4;
        add(shaft, LIFT.letter, item, width, PEN_SHAPE);
        const head = (tip: Pt, from: Pt) => {
          const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
          const hs = clamp(polyLength(shaft) * 0.18, 9, 17) * ((item.width ?? width) / 2.4) ** 0.5;
          const spread = 0.46 + R.n(0.06);
          const wing = (s: number): Pt => [tip[0] - hs * Math.cos(ang + s) + R.n(1), tip[1] - hs * Math.sin(ang + s) + R.n(1)];
          add([wing(spread), tip, wing(-spread)], LIFT.letter, item, width, PEN_SHAPE);
        };
        const h = item.head ?? 'end';
        if (h === 'end' || h === 'both') head(last(shaft), shaft[Math.max(0, shaft.length - 4)]);
        if (h === 'start' || h === 'both') head(shaft[0], shaft[Math.min(shaft.length - 1, 3)]);
      } else if (item.type === 'line') {
        const pts = item.points.map((p, i) => point(p, null, 0));
        const drawn = item.smooth === false ? pts : catmull(pts, 10);
        add(drawn.map(([px, py]) => [px + R.n(0.5), py + R.n(0.5)] as Pt), LIFT.letter, item, 2.4, PEN_SHAPE);
      } else {
        const t = item.around ?? item.under ?? item.over ?? item.target;
        if (t === undefined) throw new Error(`${item.type} needs "around" (an id, a list of ids, or {x,y,w,h})`);
        const r = rectOf(t);
        const width = 2.4;
        const draw = (pts: Pt[], lift = LIFT.letter) => add(pts, lift, item, width, PEN_SHAPE);
        const reps = item.double ? 2 : 1;
        for (let rep = 0; rep < reps; rep++) {
          const off = rep * 7;
          if (item.type === 'circle') {
            const pad = (item.pad ?? 14) + off;
            const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
            const a = (r.w / 2) * 1.12 + pad, b = (r.h / 2) * 1.2 + pad;
            const n = 3.2, tilt = R.n(0.03), phase = R.r() * 6;
            const a0 = Math.PI * 1.08 + R.n(0.25), sweep = Math.PI * 2 + 0.38 + R.n(0.12);
            const sp = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / n);
            const pts: Pt[] = [];
            for (let i = 0; i <= 80; i++) {
              const u = i / 80, th = a0 + sweep * u;
              const wob = 1 + 0.025 * Math.sin(3 * th + phase) + (u - 0.5) * 0.07;
              const px = a * wob * sp(Math.cos(th)), py = b * wob * sp(Math.sin(th));
              pts.push([cx + px * Math.cos(tilt) - py * Math.sin(tilt), cy + px * Math.sin(tilt) + py * Math.cos(tilt)]);
            }
            draw(pts);
          } else if (item.type === 'box') {
            const pad = (item.pad ?? 12) + off;
            const j = () => R.n(3);
            const tl: Pt = [r.x - pad + j(), r.y - pad + j()], tr: Pt = [r.x + r.w + pad + j(), r.y - pad + j()];
            const br: Pt = [r.x + r.w + pad + j(), r.y + r.h + pad + j()], bl: Pt = [r.x - pad + j(), r.y + r.h + pad + j()];
            const over: Pt = lerp(tl, tr, 0.06 + R.r() * 0.04);
            const pts = [...handLine(tl, tr, R), ...handLine(tr, br, R).slice(1), ...handLine(br, bl, R).slice(1), ...handLine(bl, [tl[0] + R.n(2), tl[1] + R.n(2)], R).slice(1), over];
            draw(pts);
          } else if (item.type === 'underline') {
            const y = r.y + r.h + (item.pad ?? 6) + off;
            draw(handLine([r.x - 4 + R.n(3), y + R.n(2)], [r.x + r.w + 4 + R.n(3), y + R.n(3)], R, 8));
          } else if (item.type === 'strike') {
            const y = r.y + r.h * 0.55 + off;
            draw(handLine([r.x - 5, y + R.n(3)], [r.x + r.w + 5, y + R.n(3)], R, 8));
          } else {
            // bracket and brace: built along the bottom edge in a local frame, then turned to the side.
            const side = item.side ?? 'bottom';
            const pad = (item.pad ?? 8) + off;
            const horizontal = side === 'top' || side === 'bottom';
            const span = horizontal ? r.w + 6 : r.h + 6;
            const depth = item.type === 'bracket' ? clamp(span * 0.12, 6, 14) : clamp(span * 0.08, 7, 16);
            let local: Pt[];
            if (item.type === 'bracket') {
              local = [[0, -depth + R.n(1.5)], [R.n(1), R.n(1)], ...handLine([0, 0], [span, R.n(1.5)], R, 6).slice(1, -1), [span + R.n(1), R.n(1)], [span, -depth + R.n(1.5)]];
            } else {
              const m = span / 2, q = depth;
              local = [...quad([0, -q * 0.3], [0, q * 0.5], [q, q * 0.5], 6), ...quad([m - q, q * 0.5], [m, q * 0.5], [m, q * 1.2], 6),
                ...quad([m, q * 1.2], [m, q * 0.5], [m + q, q * 0.5], 6).slice(1), ...quad([span - q, q * 0.5], [span, q * 0.5], [span, -q * 0.3], 6)];
            }
            const map = ([u, v]: Pt): Pt => {
              switch (side) {
                case 'top': return [r.x - 3 + u, r.y - pad - v];
                case 'left': return [r.x - pad - v, r.y - 3 + u];
                case 'right': return [r.x + r.w + pad + v, r.y - 3 + u];
                default: return [r.x - 3 + u, r.y + r.h + pad + v];
              }
            };
            draw(local.map(map));
          }
        }
        if (item.id) {
          const ink = inkRect(strokes) ?? r;
          reg.set(item.id, ink);
          debug.push([item.id, ink]);
        }
      }
      if (item.type !== 'text' && item.id && !reg.has(item.id)) {
        const ink = inkRect(strokes);
        if (ink) { reg.set(item.id, ink); debug.push([item.id, ink]); }
      }
    } catch (e) {
      throw new Error(`items[${index}] (${item.type}${'id' in item && item.id ? ` "${item.id}"` : ''}): ${(e as Error).message}`);
    }
    perItem.push({ strokes, item });
  });

  // Timeline: strokes follow one another with pen lifts; each item after the last.
  const speed = scene.speed ?? 1;
  const LEAD = 700, ITEM_GAP = 380;
  const all: DrawStroke[] = [];
  let t = LEAD, lastStart = LEAD, lastEnd: Pt | null = null, first = true;
  for (const { strokes, item } of perItem) {
    if (item.type === 'pause') { t += item.ms / speed; continue; }
    if (!strokes.length) continue;
    const c = item as Common;
    let cursor = c.with === 'prev' ? lastStart : t + (first ? 0 : ITEM_GAP / speed) + (c.wait ?? 0) / speed;
    lastStart = cursor;
    first = false;
    for (const s of strokes) {
      const travel = lastEnd ? dist(lastEnd, s.pts[0]) : 0;
      cursor += (s.lift + Math.min(420, (travel / (s.pen * 2.4)) * 1000)) / speed;
      const dur = Math.max(40, (s.len / s.pen) * 1000) / speed;
      all.push({ ...s, t0: cursor, dur });
      cursor += dur;
      lastEnd = last(s.pts);
    }
    t = Math.max(t, cursor);
  }

  const ink = inkRect(all);
  const pad = scene.padding ?? 40;
  const height = scene.height ?? Math.max(160, Math.ceil((ink ? ink.y + ink.h : 0) + pad));
  return { strokes: all, width: W, height, end: t, debug };
}

// ─── DOM ──────────────────────────────────────────────────────────────────────

const CSS = `
.sketch{display:block;width:100%;-webkit-user-select:none;user-select:none}
.sketch-board{position:relative;border-radius:12px;overflow:hidden;line-height:0}
.sketch-animated .sketch-board{cursor:pointer;-webkit-tap-highlight-color:transparent}
.sketch-board svg{display:block;width:100%;height:auto}
.sketch-bar{display:flex;align-items:center;gap:8px;padding:8px 2px 0;font:12px/1 system-ui,-apple-system,sans-serif;opacity:.7}
.sketch-bar:hover{opacity:1}
.sketch-bar button{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:7px;color:inherit}
.sketch-bar button:hover{background:rgba(127,127,127,.18)}
.sketch-bar svg{width:16px;height:16px;fill:currentColor}
.sketch-bar input{flex:1;min-width:0;accent-color:currentColor;margin:0}
.sketch-sound[aria-pressed="false"]{opacity:.6}
.sketch-time{font-variant-numeric:tabular-nums;min-width:72px;text-align:right}
.sketch-error{font:13px/1.45 ui-monospace,Menlo,monospace;color:#f45b73;padding:10px 12px;border:1px solid rgba(244,91,115,.45);border-radius:8px;white-space:pre-wrap}`;

const ICON = {
  play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
  replay: '<svg viewBox="0 0 16 16"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.4.5A4 4 0 1 0 8 4v2L4.8 3.3 8 .5z"/></svg>',
  soundOn: '<svg viewBox="0 0 16 16"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.2 5.2a4 4 0 0 1 0 5.6M12.2 3.4a6.5 6.5 0 0 1 0 9.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  soundOff: '<svg viewBox="0 0 16 16"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 6l4 4M14.5 6l-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

/** A stylus with its tip at the origin, lying along +x and then turned. The band near the tip takes the ink colour. */
function pencilSVG(uid: number): string {
  const grad = `sketch-pencil-grad-${uid}`, blur = `sketch-pencil-blur-${uid}`;
  return `<g class="sketch-pencil" style="display:none">
    <defs>
      <linearGradient id="${grad}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#f0efea"/><stop offset="1" stop-color="#c4c1b9"/>
      </linearGradient>
      <filter id="${blur}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>
    <g class="sketch-pencil-shadow"><g transform="rotate(58)" fill="#000" opacity=".42" filter="url(#${blur})">
      <path d="M0,0 L24,-6.5 L24,6.5Z"/><rect x="23" y="-7" width="304" height="14" rx="6"/>
    </g></g>
    <g class="sketch-pencil-body"><g transform="rotate(58)">
      <path d="M0,0 L24,-6.5 L24,6.5Z" fill="#dedcd6"/>
      <path d="M0,0 L7,-1.9 L7,1.9Z" fill="#3a3a3e"/>
      <rect class="sketch-pencil-band" x="24" y="-7" width="6" height="14" fill="#f1f0ea"/>
      <rect x="30" y="-7" width="290" height="14" fill="url(#${grad})"/>
      <path d="M320,-7 h1 a7,7 0 0 1 0,14 h-1Z" fill="#dcdad3"/>
    </g></g>
  </g>`;
}

let styled = false;
let uidCounter = 0;

function injectStyle() {
  if (styled) return;
  const s = document.createElement('style');
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
  styled = true;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function inert(el: HTMLElement): Board {
  const noop = () => {};
  return { el, duration: 0, time: 0, playing: false, sound: false, play: noop, pause: noop, seek: noop, restart: noop, setSound: noop, destroy: noop };
}

function showError(el: HTMLElement, e: unknown) {
  injectStyle();
  const d = document.createElement('div');
  d.className = 'sketch-error';
  d.textContent = `sketch: ${(e as Error)?.message ?? e}`;
  el.replaceChildren(d);
}

/** Renders a scene into an element and returns its playback controller. */
export function board(target: HTMLElement | string, scene: Scene, options: Partial<Options> = {}): Board {
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`sketch: no element matches ${target}`);
  injectStyle();
  try {
    return build(el, scene, options);
  } catch (e) {
    showError(el, e);
    return inert(el);
  }
}

function build(el: HTMLElement, scene: Scene, options: Partial<Options>): Board {
  if (!scene || !Array.isArray(scene.items)) throw new Error('a scene needs an "items" array');
  const opts: Options = {
    mode: options.mode ?? scene.mode ?? 'animation',
    autoplay: options.autoplay ?? scene.autoplay ?? 'visible',
    controls: options.controls ?? scene.controls ?? true,
    pencil: options.pencil ?? scene.pencil ?? false,
    sound: options.sound ?? scene.sound ?? false,
  };
  if (opts.mode !== 'animation' && opts.mode !== 'static') throw new Error(`mode must be "animation" or "static", not "${opts.mode}"`);
  const animated = opts.mode === 'animation';
  const { strokes, width, height, end, debug } = compile(scene);
  const bg = scene.background ?? '#0c0c0e';
  const uid = ++uidCounter;

  const paths = strokes.map((s) => `<path d="${pathD(s.pts, true)}" stroke="${s.color}" stroke-width="${s.width}"/>`).join('');
  const dbg = scene.debug
    ? debug.map(([id, r]) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#0ff" stroke-width="1" stroke-dasharray="4 3" opacity=".7"/><text x="${r.x}" y="${r.y - 4}" fill="#0ff" font-size="12" font-family="monospace">${id.replace(/[<&]/g, '')}</text>`).join('')
    : '';
  const soundBtn = opts.sound ? `<button class="sketch-sound" aria-label="Sound" aria-pressed="true">${ICON.soundOn}</button>` : '';

  el.innerHTML = `<div class="sketch${animated ? ' sketch-animated' : ''}">
    <div class="sketch-board" role="img" aria-label="Hand-drawn board">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
        ${bg === 'none' ? '' : `<rect width="${width}" height="${height}" fill="${bg}"/>`}
        <g fill="none" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
        ${dbg}
        ${animated && opts.pencil ? pencilSVG(uid) : ''}
      </svg>
    </div>
    ${animated && opts.controls ? `<div class="sketch-bar"><button class="sketch-play" aria-label="Play">${ICON.play}</button><input class="sketch-seek" type="range" min="0" max="1000" value="0" aria-label="Scrub">${soundBtn}<span class="sketch-time">0:00 / 0:00</span></div>` : ''}
  </div>`;

  // A static board is the finished drawing and nothing else: no timeline, no listeners.
  if (!animated) return inert(el);

  const svg = el.querySelector('svg')!;
  const els = Array.from(svg.querySelectorAll<SVGPathElement>('g[fill="none"] > path'));
  const lens = els.map((p) => p.getTotalLength() || 0.01);
  const playBtn = el.querySelector<HTMLButtonElement>('.sketch-play');
  const seekInput = el.querySelector<HTMLInputElement>('.sketch-seek');
  const soundInput = el.querySelector<HTMLButtonElement>('.sketch-sound');
  const timeLabel = el.querySelector<HTMLElement>('.sketch-time');
  const pencil = svg.querySelector<SVGGElement>('.sketch-pencil');
  const pencilBody = svg.querySelector<SVGGElement>('.sketch-pencil-body');
  const pencilShadow = svg.querySelector<SVGGElement>('.sketch-pencil-shadow');
  const pencilBand = svg.querySelector<SVGElement>('.sketch-pencil-band');
  const pencilScale = (width / 1000) * 0.7;
  const offscreen: Pt = [width * 0.8 + 220, height + 240];
  const duration = end + 900;

  const scratch = opts.sound ? createScratch() : null;
  let soundOn = !!scratch;
  let time = 0, playing = false, raf = 0, lastFrame = 0, scrubbing = false, lastActive = -1;
  const state: (boolean | undefined)[] = [];
  const ease = (u: number) => 0.5 * u + 0.5 * smoothstep(u);
  const easeRate = (u: number) => 0.5 + 3 * u * (1 - u);

  function render(T: number) {
    let active = -1, prev = -1, next = -1, prevEnd = -Infinity, nextStart = Infinity;
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i], p = els[i], L = lens[i];
      const u = (T - s.t0) / s.dur;
      if (u <= 0) {
        if (state[i] !== false) { p.style.visibility = 'hidden'; state[i] = false; }
        if (s.t0 < nextStart) { nextStart = s.t0; next = i; }
      } else if (u >= 1) {
        if (state[i] !== true) { p.style.visibility = ''; p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; state[i] = true; }
        if (s.t0 + s.dur > prevEnd) { prevEnd = s.t0 + s.dur; prev = i; }
      } else {
        state[i] = undefined;
        p.style.visibility = '';
        p.style.strokeDasharray = `${L} ${L + 1}`;
        p.style.strokeDashoffset = String(L * (1 - ease(u)));
        active = i;
      }
    }

    if (scratch) {
      if (playing && !scrubbing && soundOn && active >= 0) {
        const s = strokes[active];
        if (active !== lastActive) scratch.tap();
        scratch.set((lens[active] / s.dur) * 1000 * easeRate((T - s.t0) / s.dur), true);
      } else scratch.set(0, false);
    }
    lastActive = active;

    if (!pencil || !pencilBody || !pencilShadow) return;
    const visible = T > 0 && T < duration;
    pencil.style.display = visible ? '' : 'none';
    if (!visible) return;
    let pos: Pt, lift = 0;
    if (active >= 0) {
      const s = strokes[active];
      const q = els[active].getPointAtLength(lens[active] * ease((T - s.t0) / s.dur));
      pos = [q.x, q.y];
      if (pencilBand) pencilBand.setAttribute('fill', s.color);
    } else {
      // Pen lifted: glide from where the last stroke ended to where the next begins, raised a little.
      const from = prev >= 0 ? last(strokes[prev].pts) : offscreen;
      const to = next >= 0 ? strokes[next].pts[0] : offscreen;
      const t0 = prev >= 0 ? prevEnd : 0;
      const t1 = next >= 0 ? nextStart : prevEnd + 800;
      const u = clamp((T - t0) / Math.max(1, t1 - t0), 0, 1);
      pos = lerp(from, to, smoothstep(u));
      lift = Math.sin(Math.PI * u) * clamp(dist(from, to) * 0.15, 4, 30);
    }
    const k = pencilScale * (1 + lift * 0.004);
    pencilBody.setAttribute('transform', `translate(${pos[0]} ${pos[1] - lift}) scale(${k})`);
    pencilShadow.setAttribute('transform', `translate(${pos[0] + 5 + lift * 0.8} ${pos[1] + 7 + lift * 0.6}) scale(${pencilScale})`);
  }

  function ui() {
    if (playBtn) {
      const done = !playing && time >= duration;
      playBtn.innerHTML = playing ? ICON.pause : done ? ICON.replay : ICON.play;
      playBtn.setAttribute('aria-label', playing ? 'Pause' : done ? 'Replay' : 'Play');
    }
    if (soundInput) {
      soundInput.innerHTML = soundOn ? ICON.soundOn : ICON.soundOff;
      soundInput.setAttribute('aria-pressed', String(soundOn));
      soundInput.setAttribute('aria-label', soundOn ? 'Mute' : 'Unmute');
    }
    if (seekInput && !scrubbing) seekInput.value = String(Math.round((time / duration) * 1000));
    if (timeLabel) timeLabel.textContent = `${fmt(Math.min(time, end))} / ${fmt(end)}`;
  }

  function frame(now: number) {
    const dt = lastFrame ? now - lastFrame : 16;
    lastFrame = now;
    time = Math.min(duration, time + dt);
    if (time >= duration) playing = false;
    render(time);
    ui();
    if (!playing) { lastFrame = 0; return; }
    raf = requestAnimationFrame(frame);
  }

  let observer: IntersectionObserver | undefined;
  const api: Board = {
    el,
    duration,
    get time() { return time; },
    get playing() { return playing; },
    get sound() { return soundOn; },
    play() {
      if (playing) return;
      if (time >= duration) time = 0;
      playing = true;
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
      ui();
    },
    pause() {
      playing = false;
      cancelAnimationFrame(raf);
      scratch?.set(0, false);
      ui();
    },
    seek(ms: number) {
      time = clamp(ms, 0, duration);
      render(time);
      ui();
    },
    setSound(on: boolean) {
      soundOn = on && !!scratch;
      if (soundOn) scratch!.resume();
      else scratch?.set(0, false);
      ui();
    },
    restart() { api.pause(); api.seek(0); api.play(); },
    destroy() { api.pause(); observer?.disconnect(); scratch?.close(); el.innerHTML = ''; },
  };

  // Audio may only start inside a user gesture, so every control wakes it before acting.
  const toggle = () => {
    if (soundOn) scratch?.resume();
    playing ? api.pause() : api.play();
  };
  svg.parentElement!.addEventListener('click', toggle);
  playBtn?.addEventListener('click', toggle);
  soundInput?.addEventListener('click', () => api.setSound(!soundOn));
  seekInput?.addEventListener('input', () => {
    scrubbing = true;
    api.pause();
    api.seek((+seekInput.value / 1000) * duration);
    scrubbing = false;
  });

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) api.seek(duration);
  else {
    api.seek(0);
    if (opts.autoplay === true) api.play();
    else if (opts.autoplay === 'visible' && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { observer!.disconnect(); api.play(); }
      }, { threshold: 0.35 });
      observer.observe(el);
    }
  }
  return api;
}

/** Renders every <script type="text/sketch"> (JSON scene) in place. */
export function mount(root: ParentNode = document): Board[] {
  const boards: Board[] = [];
  root.querySelectorAll<HTMLScriptElement>('script[type="text/sketch"], script[type="application/sketch+json"]').forEach((script) => {
    const host = document.createElement('div');
    script.after(host);
    try {
      boards.push(board(host, JSON.parse(script.textContent || '')));
    } catch (e) {
      showError(host, e);
    }
  });
  return boards;
}

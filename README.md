# @ghostmind-dev/sketch

Hand-written explainer boards for the browser — the look of a maths video recorded on an
iPad. One scene (JSON) renders two ways:

- **animation** — handwriting, brackets, circles and arrows written stroke by stroke,
  with a play / scrub bar;
- **static** — the finished board as a single image, nothing moving.

Every mark is an open pen stroke: text uses a clean single-line font (EMS Readability),
Greek and maths symbols use Hershey strokes, and annotations — circles, arrows, brackets,
boxes — are drawn with a hand's wobble and overshoot. Text and maths stay crisp so a board
reads easily. Nothing is a filled outline, so everything can be revealed along the path the
pen took.

One IIFE file (`dist/sketch.iife.js`, ~60 KB) defines the global `Sketch`. It needs no
network, no workers and no web fonts, and does nothing until called — so it also runs in
sandboxed iframes and under a strict Content-Security-Policy (inline it there).

## Use it in a page

```html
<script src="https://cdn.jsdelivr.net/npm/@ghostmind-dev/sketch@0.4.0/dist/sketch.iife.js"></script>

<script type="text/sketch">
{
  "mode": "animation",
  "items": [
    { "type": "text", "id": "eq", "x": 500, "y": 30, "align": "center", "size": 44,
      "text": "\\id{lhs}{E} = m\\id{c2}{c^{2}}" },
    { "type": "circle", "around": "eq.c2", "color": "yellow" },
    { "type": "text", "id": "note", "below": "eq.c2", "gap": 70, "size": 26, "color": "yellow",
      "text": "speed of light, squared" },
    { "type": "arrow", "from": "eq.c2", "to": "note", "color": "yellow" }
  ]
}
</script>
<script>Sketch.mount();</script>
```

Change `"mode"` to `"static"` for the finished board with no animation.

### Scenes

A lesson is rarely one board. Give `scenes` instead of `items` and each is written, held, then
wiped before the next begins — the way a teacher fills a board, clears it, and carries on:

```json
{
  "scenes": [
    { "label": "the claim",   "items": [ … ],                 "hold": 1400 },
    { "label": "the squares", "items": [ … ], "clear": "cut" },
    { "label": "in numbers",  "items": [ … ] }
  ]
}
```

| field | does |
|---|---|
| `items` | that scene's board, drawn from nothing |
| `label` | named in the control bar while it plays |
| `hold` | ms the finished board is held before it clears (default 1200) |
| `clear` | `"fade"` (default), `"cut"`, or `false` to leave it up |

**Ids live inside a scene**, so every scene may reuse `title`, `eq` and the rest without clashing.
The last scene stays on the board. A **static** board has no time, so its scenes stack down the
page as a storyboard instead of replacing each other.

`Sketch.mount(root?)` renders every `<script type="text/sketch">` in place.
`Sketch.board(el, scene, options)` does the same for one element (or a selector) and returns a
controller (`play`, `pause`, `seek(ms)`, `restart`, `duration`); options (`mode`, `autoplay`,
`controls`) override the scene's. A static board's controller does nothing.

The board fills its container's width and sizes its own height, so no `100vh` or fixed height is needed.

### Letting the reader set the pace

A board can wait rather than run on. With `"advance": "click"` each scene stops the moment its
board is complete, and a **next** button appears over it; the story continues when the reader asks.
Good when a scene needs thinking about, and the natural partner to narration later.

```json
{ "advance": "click", "scenes": [ … ] }
```

A single scene can ask for it on its own (`"advance": "click"` inside that scene), or opt out of a
board that otherwise waits (`"advance": "auto"`). The last scene never waits — there is nothing
after it.

### Pencil and sound

Both are off by default and apply to animations only. `"pencil": true` shows a tool whose
tip follows the stroke being written, lifting and gliding between strokes. Pick one with
`"pencil": "pencil" | "marker" | "chalk" | "stylus"` — a short yellow pencil, a chunky marker with
a blunt nib, a chalk stub, or the long stylus (`true` means `pencil`; `false` or `"none"` draws
nothing). `"sound": true`
adds a writing sound, synthesised in the browser with Web Audio — noise shaped by the pen's
speed, with a soft tap as each stroke begins; there are no audio files. Browsers only allow
audio after a user gesture, so sound begins once the reader clicks play or taps the board (a
board autoplaying on scroll stays silent until then). A speaker button in the bar mutes it;
from code, `board.setSound(false)`.

### Fonts

Text is written with **readability**, a single-stroke font — the path a pen travels, not a filled
outline. `Sketch.fonts` lists what the bundle carries, and a scene or a single text item can name
one with `"font"`. Greek and maths symbols come from a shared set and work regardless.

## Scene

```jsonc
{
  "mode": "animation",    // "animation" (written stroke by stroke) | "static" (finished board)
  "width": 1000,          // board units across; the board scales to its container's width
  "height": 600,          // optional — defaults to the ink's extent plus padding
  "background": "#0c0c0e",// or "none" to draw on the page itself
  "color": "white",       // default ink; with "background": "none", white follows the page's text colour
  "font": "readability",  // text font; `Sketch.fonts` lists what the bundle includes (a text item can set its own)
  "speed": 1,             // animation: playback speed multiplier
  "autoplay": "visible",  // animation: true | false | "visible" (first time it scrolls into view)
  "controls": true,       // animation: play / scrub bar under the board
  "pencil": false,        // animation: a stylus rides the tip of each stroke as it is written
  "sound": false,         // animation: a synthesised writing sound that follows the pen (adds a mute button)
  "seed": 0,              // change for different handwriting on the same scene
  "debug": false,         // outline every id
  "items": [ … ]          // drawn in order
}
```

Colours: `white yellow lime green blue cyan purple magenta pink red orange grey`, or any CSS colour.

### Items

Every item accepts `id`, `color` and `width` (stroke). For animations, also `wait` (ms before
it starts), `speed` (pen speed multiplier) and `"with": "prev"` (draw alongside the previous
item); static boards ignore these.

| type | fields |
|---|---|
| `text` | `text`, `x`, `y` (top of the text), `size` (32), `font`, `align`, `maxWidth`, `lineHeight`; or place relative: `below` / `above` / `rightOf` / `leftOf` an id, with `gap`, `dx`, `dy` |
| `arrow` | `from`, `to`, optional `via` points, `bend` (−1…1), `gap`, `head` (`end` `start` `both` `none`) |
| `line` | `points`, `smooth` |
| `circle` · `box` | `around`, `pad` |
| `underline` · `strike` | `under` / `over`, `double` |
| `bracket` · `brace` | `around`, `side` (`bottom` `top` `left` `right`), `pad` |
| `pause` | `ms` |

**Targets** (`around`, `under`, `over`) are an id, a list of ids (their union), or `{ "x", "y", "w", "h" }`.

**Points** (`from`, `to`, `via`, `points`) are `[x, y]`, an id (the arrow meets its nearest
edge), an id with a side — `eq.bottom`, `.top`, `.left`, `.right`, `.center`, `.topLeft` … —
or `{ "at": "eq.bottom", "dx": 0, "dy": 8 }`.

An id can only be referenced once the item that defines it has been drawn (earlier in `items`).

### Text markup

| write | get |
|---|---|
| `x^{2}` · `x_{i}` | superscript · subscript |
| `\frac{∂v}{∂t}` | stacked fraction, written numerator → bar → denominator |
| `\vec{v}` `\bar{x}` `\hat{x}` `\dot{x}` | decorations |
| `\sqrt{x}` · `\ul{x}` | root · underline |
| `\id{name}{…}` | names part of the text: target it as `textId.name` |
| `\alpha` `\partial` `\nabla` `\to` `\approx` … | symbols (or type ρ ∂ ∇ → directly) |
| `\sin` `\cos` `\log` `\lim` … | written as the plain word |
| `\n` | new line |

In JSON, backslashes double: `"\\frac{a}{b}"`.

## Development

```bash
npm install
npm run build                                   # glyphs → src/glyphs.generated.ts, bundle → dist/
npm run check                                   # typecheck
npm run harness                                 # harness/index.html: every example under a strict CSP
npm run render -- examples/navier-stokes.json   # renders/navier-stokes.png, the finished board
npm run render -- scene.json --at=2000,6000,end --debug --width=700
```

`render` screenshots the board in headless Chrome under a no-network CSP (set `CHROME` if
Chrome is not at the macOS default path). It is the quickest way to check a scene's layout.

## Publishing

```bash
npm version <patch|minor> && npm publish   # scoped, public (publishConfig); prepublishOnly checks and builds
```

Never republish a version. jsDelivr picks new versions up from npm within minutes.

## Licences

Code: MIT. Glyph data: EMS Felix under the SIL Open Font License 1.1 (`fonts/OFL.txt`);
Hershey Greek and maths strokes via hersheytext (MIT). See `LICENSE`.

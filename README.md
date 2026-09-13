# @ghostmind-dev/sketch

Hand-written explainer boards for Potion `html` blocks — the look of a maths video
recorded on an iPad. One scene (JSON) renders two ways:

- **animation** — handwriting, brackets, circles and arrows written stroke by stroke,
  with a play / scrub bar;
- **static** — the finished board as a single image, nothing moving.

Every mark is an open pen stroke: Latin text uses a single-line handwriting font
(EMS Felix), Greek and maths symbols use Hershey strokes, and shapes are drawn with a
hand's wobble and overshoot. Nothing is a filled outline, so everything can be revealed
along the path the pen took.

One IIFE file (`dist/sketch.iife.js`, ~60 KB) defines `PotionSketch`. It needs no
network, no workers and no fonts, and does nothing until called — it fits the Potion
block sandbox as-is.

## In a note

````
```html
<!-- potion:use @ghostmind-dev/sketch@0.1.0 -->
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
<script>PotionSketch.mount();</script>
```
````

Change `"mode"` to `"static"` for the finished board with no animation.

`mount()` renders every `<script type="text/sketch">` in place. `PotionSketch.board(el, scene, options)`
does the same for one element and returns a controller (`play`, `pause`, `seek(ms)`, `restart`,
`duration`); options (`mode`, `autoplay`, `controls`) override the scene's. A static board's
controller does nothing.

## Scene

```jsonc
{
  "mode": "animation",    // "animation" (written stroke by stroke) | "static" (finished board)
  "width": 1000,          // board units across; the board scales to the note's width
  "height": 600,          // optional — defaults to the ink's extent plus padding
  "background": "#0c0c0e",// or "none" to write on the note itself
  "color": "white",       // default ink
  "speed": 1,             // animation: playback speed multiplier
  "autoplay": "visible",  // animation: true | false | "visible" (first time it scrolls into view)
  "controls": true,       // animation: play / scrub bar under the board
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
| `text` | `text`, `x`, `y` (top of the text), `size` (32), `align`, `maxWidth`, `lineHeight`; or place relative: `below` / `above` / `rightOf` / `leftOf` an id, with `gap`, `dx`, `dy` |
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

### Text markup

| write | get |
|---|---|
| `x^{2}` · `x_{i}` | superscript · subscript |
| `\frac{∂v}{∂t}` | stacked fraction, written numerator → bar → denominator |
| `\vec{v}` `\bar{x}` `\hat{x}` `\dot{x}` | decorations |
| `\sqrt{x}` · `\ul{x}` | root · underline |
| `\id{name}{…}` | names part of the text: target it as `textId.name` |
| `\alpha` `\partial` `\nabla` `\to` `\approx` … | symbols (or type ρ ∂ ∇ → directly) |
| `\n` | new line |

In JSON, backslashes double: `"\\frac{a}{b}"`.

## Development

```bash
npm install
npm run build                                   # glyphs → src/glyphs.generated.ts, bundle → dist/
npm run check                                   # typecheck
npm run harness                                 # harness/index.html: every example under the block CSP
npm run render -- examples/navier-stokes.json   # renders/navier-stokes.png, the finished board
npm run render -- scene.json --at=2000,6000,end --debug --width=700
```

`render` screenshots the board in headless Chrome under the sandbox's CSP (set `CHROME` if
Chrome is not at the macOS default path). It is how a scene gets checked before it goes into
a note.

## Publishing and registering

```bash
npm publish                     # scoped, public (publishConfig); prepublishOnly checks and builds
```

Later releases: `npm version patch && npm publish`. Never republish a version.

Then add to `BLOCK_LIBRARIES` in Potion's `ui/app/src/lib/block-libraries.ts` (the key is what notes
write; the directive parser splits on the last `@`, so a scoped name works):

```ts
'@ghostmind-dev/sketch': {
  pkg: '@ghostmind-dev/sketch',
  global: 'PotionSketch',
  summary: 'Hand-written explainer boards: one scene renders as handwriting written stroke by stroke, or as the finished board.',
  when: 'Explaining an equation or an idea the way a teacher would on a board. Plain HTML or mermaid stay the default for ordinary diagrams.',
  builds: ['dist/sketch.iife.js'],
},
```

and check `curl -s https://potion.run/api/vendor/@ghostmind-dev/sketch/0.1.0 | head -c 200`
(the exact route shape for scoped names depends on Potion's vendor route).

## Licences

Code: MIT. Glyph data: EMS Felix under the SIL Open Font License 1.1 (`fonts/OFL.txt`);
Hershey Greek and maths strokes via hersheytext (MIT). See `LICENSE`.

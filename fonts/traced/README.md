# Traced hands (not bundled)

`casual` and `flair`, traced from generated character sheets. They are kept here so the work is not
lost, but the build does not ship them: `scripts/build-glyphs.mjs` reads `src/fonts/*.json`, so a
hand becomes part of the bundle by moving its file there.

Each file is `character -> [advance, strokes]`, 1000 units per em, baseline y=0, y down, capitals
700 tall — the same shape the generated glyph data uses.

# Line Diagram Generator

A browser-based tool for drawing MRT/LRT-style transit line diagrams — inspired by
the Singapore rail network. Give it a line name, colour, and a plain-text station
list, and it draws a diagram with horizontal, vertical, or loop layouts, branch
lines, auto-coloured interchange codes, and a legend. Export to SVG, PNG, or JSON.

No build step — open `index.html` directly in a browser.

## Structure

- `index.html` — page shell
- `styles.css` — all styling, including light/dark theme variables
- `app.js` — the SVG renderer and the app (editor UI, presets, import/export)

## Optional: LTA Identity font

The diagrams can render station names/codes in **LTA Identity**, the font used on
Singapore's transit signage — reconstructed (unofficially, no stated licence) by
[jglim/IdentityFont](https://github.com/jglim/IdentityFont). Because that repo has
no licence file, this project does **not** bundle the font — you opt in yourself:

1. Download `LTAIdentity-Medium.woff2` (and `.woff` for older browsers) from the
   [project's Releases page](https://github.com/jglim/IdentityFont/releases).
2. Create a `fonts/` folder next to `index.html` and drop the files in.

If the folder is empty, the CSS `@font-face` simply fails to load and the page
falls back to the system font stack — nothing breaks either way. `fonts/` is
git-ignored so the font is never committed or redistributed from this repo.

Exported SVG/PNG files try to embed the font's actual bytes as a data URI so it
survives outside the app (an external `@font-face` reference means nothing once
the SVG stands alone). This embedding step uses `fetch()`, which browsers block
for local files when you've opened `index.html` directly via `file://` — in that
case exports just silently fall back to the system font, same as the live page
would without the font installed. Serve the folder over `http://` (e.g. a quick
`python -m http.server`) if you want the font embedded in exports too.

## Station list syntax

One station per line:

```
CODE  Station Name  > IC1, IC2
```

- Everything after `>` is a comma-separated list of interchange codes — each is
  auto-coloured by its line prefix (edit the `LINE_INFO` table in `app.js` to add
  more lines/prefixes).
- Use `CODE | Name` instead if the name would otherwise be ambiguous.
- `#` starts a comment line.

Branches start with a header line and are followed by their own stations:

```
[branch from CC4 up]
CE1  Bayfront
CE2  Marina Bay
```

Direction is `up`/`down` for horizontal layouts, `left`/`right` for vertical. For
loops it's also `up`/`down`, but optional — leave it out and the branch points
straight out from whichever side of the loop it sits on. Give an explicit
direction and it always shoots that way instead, which lets a branch grow into
the loop's own interior rather than away from it; the loop grows taller (from a
pill into a rounded rectangle) automatically to make room. Add `: #hexcolour` at
the end of the header to override the branch's colour.

**Branch spacing**, next to station spacing in the Layout section, controls
how far a branch's line sits from the trunk it splits off from.

The **Editor** view (default) gives you a row-based UI for all of this — add/
reorder/delete stations and branches without touching text. The **⇅** button
next to the Editor/Text toggle reverses the trunk's station order in place
(handy for flipping which end a line reads from without retyping it). Switch
to **Text** to paste/edit the raw syntax directly, or to copy it out.

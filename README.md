# Line Diagram Generator

A browser-based tool for drawing MRT/LRT-style transit line diagrams — inspired by
the Singapore rail network. Give it a line name, colour, and a plain-text station
list, and it draws a diagram with horizontal, vertical, or loop layouts, branch
lines, auto-coloured interchange codes, and a legend. Export to SVG, PNG, or JSON.

No build step — open `index.html` directly in a browser.

Undo/redo (↶/↷ in the header, or Ctrl+Z / Ctrl+Y) covers the whole diagram —
every field, preset switch, and editor action — not just the station list.
It's debounced, so a burst of typing collapses into one undo step. While a
text field has focus, Ctrl+Z/Ctrl+Y is left alone so the field's own native
undo still works as expected.

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
  more lines/prefixes). Add the reserved code `BUS` to that list to mark a
  nearby bus interchange — it renders as its own icon instead of a colour
  caplet, and is toggled separately ("Show bus interchanges").
- Tag a station with `{sir}` to mark it as a SIR express-service stop — it
  renders with a dark outline around its own caplet instead of the usual light
  one, toggled separately ("Show SIR express stops"). Combine with a roadmap
  tag using a comma, e.g. `{proposed,sir}`.
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

**Bridge branches** (Central Line Hainault Loop style): add `to CODE` right
after the `from` code to make a branch rejoin the trunk
at a *different* station instead of dead-ending — e.g. London's Central
Line, which splits at Leytonstone and rejoins the trunk at South Woodford
by way of the Hainault Loop:

```
[branch from CL4 to CL2 up]
HL1  Wanstead
HL2  Redbridge
HL3  Gants Hill
HL4  Newbury Park
HL5  Barkingside
HL6  Fairlop
HL7  Hainault
```

Its own stations use the same fixed pitch as everywhere else in the
diagram, so a bridge branch with enough stations naturally overshoots past
the "to" station and curves back to meet it — same as the real Hainault
Loop extends further out than the direct trunk distance. Only supported on
a horizontal trunk — elsewhere it falls back to a normal dead-end branch
with a warning. Both the `from` and `to` stations get the same 1.5x
flanking-gap treatment a normal branch junction gets, on both sides. Its
stations also land on the same station-spacing grid as the trunk (measured
from the `from` station), so they line up vertically with wherever an
ordinary trunk station could sit.

Each end has its own independent grow direction and curve style, same as a
normal branch — `left`/`right` right after the `from` code sets the start
end's grow, `growTo:left`/`growTo:right` sets the end end's; a bare
`orthogonal` sets the start end's curve, `curveTo:orthogonal` the end
end's. Left unset, an end's grow defaults to "auto" — whichever way
actually reaches the other junction directly. Set it to the *other* way
instead and that end hooks out that way first, up and over, before
doubling back to become the row — like a small U-turn off the trunk:

```
[branch from CL4 to CL2 up growTo:left]
```

Marking a bridge branch `shuttle` (`[branch from CL4 to CL2 up shuttle]`)
locks both ends to an orthogonal turn, same as a normal stub shuttle.

Both ends always use the same fixed curve size regardless of station
count — the straight middle section (where the stations sit) stretches or
shrinks to take up whatever room is left, rather than the curves
themselves growing long and thin. If the two junctions don't naturally
have enough room between them for that, the trunk itself grows to fit:
extra whole station-pitch gaps get inserted between them (preferring the
gaps strictly between the two junctions over their own 1.5x gaps, so
everything else stays right on the station-spacing grid).

### Loop shape

Setting **Shape** to Loop draws the *entire* trunk as a single closed
racetrack (e.g. Circle Line) instead of a straight line — untick "Closed
loop" to leave it open-ended instead (a plain arc). The **Orientation**
row still applies here too: Horizontal reads stations across the top and
bottom of the racetrack (the classic Circle Line shape), Vertical reads
them down the right side and back up the left instead, for a tall loop.
**Rotate loop** (↺/↻) cycles which station the racetrack starts drawing
from, independent of orientation.

### Trunk end-loops

A **balloon loop** is part of the trunk's own shape, not a branch — it's for
a line that reverses via a loop rather than a plain terminus (Bukit Panjang
LRT's loop off Bukit Panjang, or one of Sengkang LRT's East/West loops off
the shared Sengkang station — see those two presets for worked examples).
Start a `[loop at start]` or `[loop at end]` section after the trunk's own
stations, naming whichever end of the trunk's *own station list* it attaches
to and rejoins — no station code needed, since a trunk only has two ends:

```
BP5  Phoenix
BP6  Bukit Panjang

[loop at end]
BP7  Petir
BP8  Pending
```

Which way it extends is always automatic — it continues the trunk's own
reading direction when it has one (2+ trunk stations), or follows the
diagram's overall orientation for a single-station trunk with no direction
of its own (Sengkang). Works on both horizontal and vertical layouts. Two
`[loop at end]` sections (or two `[loop at start]`) gives a bowtie/figure-8
off that single end, like Sengkang LRT; one `[loop at start]` and one
`[loop at end]` gives a dumbbell shape instead. Not available when the
line's own Shape is set to Loop — a closed loop trunk has no "start"/"end"
for a balloon loop to hang off.

The **Editor** view (default) gives you a row-based UI for all of this — add/
reorder/delete stations and branches without touching text. The **⇅** button
next to the Editor/Text toggle reverses the trunk's station order in place
(handy for flipping which end a line reads from without retyping it) — every
branch and balloon loop block has its own **⇅** too, reversing just that
list. Switch to **Text** to paste/edit the raw syntax directly, or to copy
it out.

### Roadmap tiers (Current / Future / Proposed)

Tag a station or branch header with `{future}` or `{proposed}` to mark it as
part of a later construction phase, right in its natural position in the
list (rather than keeping separate near-duplicate station lists per phase):

```
NS5  Yew Tee
NS6  Sungei Kadut  > DE2 {future}
NS7  Kranji
```

An untagged line is "current" and always shows. The **Roadmap** toggle at
the top of the sidebar (Current/Future/Proposed) controls which tagged
stations actually render on the diagram, and also which preset lines show
up in the picker at all — Future-tier lines (e.g. Jurong Region Line) only
appear once you're at Future or Proposed; Proposed-tier lines only at
Proposed. The **Editor**/**Text** views always show every station
regardless of the toggle — only the rendered diagram and the preset picker
respect it, so tagged rows don't unexpectedly vanish while you're editing.

Add `until:future` or `until:proposed` to a station or branch header for the
rarer opposite case — something that exists now (or from a given tier on)
but gets converted or removed later in the roadmap, e.g. a branch that gets
absorbed into a different line by the time the proposed tier is reached:

```
[branch from EW4 down shuttle CG] {until:future}
```

This branch renders at Current and Future, then disappears at Proposed.
Combine tags with a comma, e.g. `{proposed,sir}` or `{future,until:proposed}`.

A station's interchange codes (after `>`) are filtered by the *other* line's
own tier too, independent of the host station's tag — e.g. a real, open-today
station can list a Cross Island Line cross-reference that only appears once
the Roadmap toggle reaches Future, since CRL doesn't exist yet at Current.
This is driven by each line prefix's own `tier` in the `LINE_INFO` table.

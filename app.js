"use strict";
/* ============================================================================
   Line Diagram Generator — MRT-style transit line diagrams
   Layouts: horizontal strip · snake (wrapped) · vertical list · loop
   Supports branches off any station, and auto-coloured interchange codes.
   ========================================================================== */

const SVGNS = "http://www.w3.org/2000/svg";

/* ---------------------------------------------------------------- registry */
/* Prefix -> { name, colour }, so interchange code boxes get the right line
   colour and the diagram legend can name every line it references.
   Edit/extend freely; unknown prefixes fall back to the current line. */
const LINE_INFO = {
  NS:{ name:"North-South Line", colour:"#d42e12", acr:"NSL" },
  EW:{ name:"East-West Line", colour:"#009645", acr:"EWL" },
  CG:{ name:"East-West Line", colour:"#009645", acr:"EWL" },
  NE:{ name:"North East Line", colour:"#9900aa", acr:"NEL" },
  CC:{ name:"Circle Line", colour:"#fa9e0d", acr:"CCL" },
  CE:{ name:"Circle Line", colour:"#fa9e0d", acr:"CCL" },
  DT:{ name:"Downtown Line", colour:"#005ec4", acr:"DTL" },
  TE:{ name:"Thomson-East Coast Line", colour:"#9d5b25", acr:"TEL" },
  JS:{ name:"Jurong Region Line", colour:"#0099aa", acr:"JRL" },
  JW:{ name:"Jurong Region Line", colour:"#0099aa", acr:"JRL" },
  JE:{ name:"Jurong Region Line", colour:"#0099aa", acr:"JRL" },
  JR:{ name:"Jurong Region Line", colour:"#0099aa", acr:"JRL" },
  CR:{ name:"Cross Island Line", colour:"#97c616", acr:"CRL" },
  CP:{ name:"Cross Island Line", colour:"#97c616", acr:"CRL" },
  BP:{ name:"Bukit Panjang LRT", colour:"#718573", acr:"BP" },
  STC:{ name:"Sengkang LRT", colour:"#718573", acr:"STC" }, SW:{ name:"Sengkang LRT", colour:"#718573", acr:"STC" }, SE:{ name:"Sengkang LRT", colour:"#718573", acr:"STC" },
  PTC:{ name:"Punggol LRT", colour:"#718573", acr:"PTC" }, PW:{ name:"Punggol LRT", colour:"#718573", acr:"PTC" }, PE:{ name:"Punggol LRT", colour:"#718573", acr:"PTC" },
  RTS:{ name:"RTS Link", colour:"#718573", acr:"RTS" }
};
const SWATCHES = ["#d42e12","#009645","#9900aa","#fa9e0d","#005ec4","#9d5b25",
                 "#0099aa","#97c616","#718573","#e8467c","#00a1de","#1f2937"];

function colourForCode(code, fallback){
  const m = /^([A-Z]+)/.exec((code||"").toUpperCase());
  const info = m && LINE_INFO[m[1]];
  return (info && info.colour) || fallback;
}

/* Picks white or dark text for legibility against a given caplet/badge
   background colour (e.g. Circle Line's light orange needs dark text). */
function contrastText(hex){
  const c = (hex || "").replace("#", "");
  if (c.length !== 6) return "#fff";
  const r = parseInt(c.slice(0,2), 16), g = parseInt(c.slice(2,4), 16), b = parseInt(c.slice(4,6), 16);
  const yiq = (r*299 + g*587 + b*114) / 1000;
  return yiq >= 150 ? "#1b1f24" : "#ffffff";
}

/* ------------------------------------------------------------------- style */
const STYLE = {
  lineWidth:6,
  icStroke:"#33383d",
  nameSize:14, nameWeight:600, nameFill:"#1b1f24",
  codeSize:10.5, codeH:20, codeGap:14,
  capletOutlineW:1.3
};
const FONT = '"LTA Identity", -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif';

/* Rough text width; good enough for bounding boxes and label offsets. */
const measure = (t, size) => (t ? t.length * size * 0.565 : 0);

/* Splits a long name into two roughly-balanced lines at a word boundary
   (used for loop-layout station names, which read horizontally centred and
   would otherwise run into neighbouring stations). Returns [name] unchanged
   if it's short enough or has no word boundary to split at. */
function wrapName(name, threshold){
  if (!name || name.length <= threshold) return [name];
  const words = name.split(" ");
  if (words.length < 2) return [name];
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++){
    const l1 = words.slice(0, i).join(" ").length;
    const l2 = words.slice(i).join(" ").length;
    const diff = Math.abs(l1 - l2);
    if (diff < bestDiff){ bestDiff = diff; best = i; }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}
/* All codes up to 4 chars share one uniform caplet width (as if every code
   were 4 chars) so e.g. EW7 and EW23 render the same size; only longer
   strings (used for legend acronyms like BPLRT) grow past that. */
const CODE_BOX_W_MIN = 4 * 6.6 + 11;
/* Splits a trailing letter-suffix off a code (e.g. "TE22A" -> base "TE22",
   suffix "A") — real infill-station codes like this render the suffix
   smaller, and it shouldn't make the caplet any wider than a normal one. */
function splitCodeSuffix(t){
  const m = /^([A-Za-z]+\d+)([A-Za-z])$/.exec(t || "");
  return m ? { base:m[1], suffix:m[2] } : { base:t || "", suffix:"" };
}
const codeBoxW = t => Math.max(CODE_BOX_W_MIN, splitCodeSuffix(t).base.length * 6.6 + 11);
/* Fills a <text> element, rendering a detected suffix letter smaller. */
function setCodeText(tx, text, fontSize){
  const { base, suffix } = splitCodeSuffix(text);
  if (!suffix){ tx.textContent = text; return; }
  const t1 = document.createElementNS(SVGNS, "tspan");
  t1.textContent = base;
  tx.appendChild(t1);
  const t2 = document.createElementNS(SVGNS, "tspan");
  t2.setAttribute("font-size", (fontSize * 0.72).toFixed(2));
  t2.textContent = suffix;
  tx.appendChild(t2);
}

/* ------------------------------------------------------------------ parsing */
function parseStation(s){
  let left = s, ics = [];
  const gi = s.indexOf(">");
  if (gi >= 0){
    left = s.slice(0, gi);
    ics = s.slice(gi + 1).split(/[,;]+/).map(t => t.trim()).filter(Boolean);
  }
  left = left.trim();
  let code = "", name = left;
  if (left.includes("|")){
    const p = left.split("|");
    code = p[0].trim();
    name = p.slice(1).join("|").trim();
  } else {
    const m = /^([A-Z]{1,4}\d{0,3}[A-Za-z]?)\s+(\S.*)$/.exec(left);
    if (m){ code = m[1]; name = m[2].trim(); }
    else if (/^[A-Z]{1,4}\d{0,3}[A-Za-z]?$/.test(left)){ code = left; name = ""; }
  }
  return { code, name, ics };
}

function parseSpec(text){
  const errors = [];
  const trunk = [];
  const branches = [];
  let cursor = trunk;

  text.split(/\r?\n/).forEach((raw, i) => {
    const s = raw.trim();
    if (!s || s.startsWith("#") || s.startsWith("//")) return;
    if (s.startsWith("[")){
      const m = /^\[\s*branch\s+from\s+([^\s,;\]]+)\s*(.*?)\s*\]$/i.exec(s);
      if (!m){
        errors.push(`Line ${i+1}: expected <code>[branch from CODE up shuttle CP1 orthogonal: #hex]</code>`);
        return;
      }
      const from = m[1];
      let rest = m[2];

      /* everything after the first ':' is optional colour override */
      let colour = null;
      const colonIdx = rest.indexOf(":");
      if (colonIdx >= 0){
        let tail = rest.slice(colonIdx + 1).trim();
        rest = rest.slice(0, colonIdx).trim();
        const cm = /(#[0-9a-fA-F]{3,8})\s*$/.exec(tail);
        if (cm) colour = cm[1];
      }

      /* remaining space-separated keywords, order-independent. up/down and
         left/right are captured separately since a horizontal/loop branch
         can use both at once: up/down as which side of the trunk it sits
         on, left/right as which way its own stations grow. */
      const DIRS_UD = ["up", "down"];
      const DIRS_LR = ["left", "right"];
      const DIRS = [...DIRS_UD, ...DIRS_LR];
      const tokens = rest.split(/\s+/).filter(Boolean);
      let dirUD = "", dirLR = "", mode = "split", shuttleLabel = "", curve = "smooth";
      for (let ti = 0; ti < tokens.length; ti++){
        const t = tokens[ti].toLowerCase();
        if (DIRS_UD.includes(t)) dirUD = t;
        else if (DIRS_LR.includes(t)) dirLR = t;
        else if (t === "shuttle"){
          mode = "shuttle";
          const next = tokens[ti + 1];
          if (next && !DIRS.includes(next.toLowerCase()) &&
              !["orthogonal", "ortho", "smooth", "curvy", "curve"].includes(next.toLowerCase())){
            shuttleLabel = next;
            ti++;
          }
        }
        else if (t === "orthogonal" || t === "ortho") curve = "orthogonal";
        else if (t === "smooth" || t === "curvy" || t === "curve") curve = "smooth";
      }
      const dir = dirUD || dirLR;   // which side: up/down (horizontal), left/right (vertical)
      const grow = dirLR;          // which way branch stations grow: left/right (horizontal & loop only)

      if (mode === "shuttle") curve = "orthogonal";   // shuttle tracks are always orthogonal
      const b = { from, dir, grow, mode, shuttleLabel, curve, colour, stations:[], line:i+1 };
      branches.push(b);
      cursor = b.stations;
      return;
    }
    cursor.push(parseStation(s));
  });

  if (!trunk.length && branches.length)
    errors.push("A branch header appeared before any trunk stations.");

  return { trunk, branches, errors };
}

/* -------------------------------------------------------------- svg helpers */
function el(tag, attrs, parent){
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function makeBBox(){
  return {
    x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity,
    add(x, y){
      if (x < this.x0) this.x0 = x;
      if (y < this.y0) this.y0 = y;
      if (x > this.x1) this.x1 = x;
      if (y > this.y1) this.y1 = y;
    },
    rect(x, y, w, h){ this.add(x, y); this.add(x + w, y + h); },
    /* baseline start + rotation, anchored 'start' or 'end' */
    text(x, y, str, size, rot, anchor){
      const w = measure(str, size), r = rot * Math.PI / 180;
      const sgn = anchor === "end" ? -1 : 1;
      const ex = x + Math.cos(r) * w * sgn, ey = y + Math.sin(r) * w * sgn;
      this.add(x, y - size); this.add(x, y + size * .4);
      this.add(ex, ey - size); this.add(ex, ey + size * .4);
    }
  };
}

/* Polyline with rounded corners (quadratic joins). */
function roundedPath(pts, r){
  if (pts.length < 2) return "";
  const P = n => `${n[0].toFixed(2)} ${n[1].toFixed(2)}`;
  let d = `M ${P(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++){
    const a = pts[i-1], c = pts[i], b = pts[i+1];
    const l1 = Math.hypot(a[0]-c[0], a[1]-c[1]) || 1;
    const l2 = Math.hypot(b[0]-c[0], b[1]-c[1]) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = [c[0] + (a[0]-c[0])/l1*rr, c[1] + (a[1]-c[1])/l1*rr];
    const p2 = [c[0] + (b[0]-c[0])/l2*rr, c[1] + (b[1]-c[1])/l2*rr];
    d += ` L ${P(p1)} Q ${P(c)} ${P(p2)}`;
  }
  d += ` L ${P(pts[pts.length-1])}`;
  return d;
}

/* A short thick bar between two out-of-station-interchange caplets, split
   into two colours (matching each side) by a diagonal seam angled 30°
   off square to the bar, rather than a plain straight cut. */
function drawOsiConnector(el, parent, x0, y0, x1, y1, thickness, colourA, colourB){
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;      // unit vector along the bar
  const px = -uy, py = ux;                 // unit vector across the bar
  const halfT = thickness / 2;
  const slant = halfT * Math.tan(Math.PI / 6);   // 30° off square
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const F2 = v => v.toFixed(2);
  const top = [mx + px*halfT + ux*slant, my + py*halfT + uy*slant];
  const bot = [mx - px*halfT - ux*slant, my - py*halfT - uy*slant];
  const c0 = [x0 + px*halfT, y0 + py*halfT], c1 = [x0 - px*halfT, y0 - py*halfT];
  const c2 = [x1 + px*halfT, y1 + py*halfT], c3 = [x1 - px*halfT, y1 - py*halfT];
  const pts = p => p.map(q => `${F2(q[0])},${F2(q[1])}`).join(" ");
  el("polygon", { points:pts([c0, top, bot, c1]), fill:colourA }, parent);
  el("polygon", { points:pts([top, c2, c3, bot]), fill:colourB }, parent);
}

/* -------------------------------------------------------- stadium (loop) */
/* Arc-length parameterised rounded-rect outline — a stadium/pill whenever
   r = height/2 (the "side" edges collapse to zero length), or a genuine
   rounded rectangle with real vertical sides once the shape is taller than
   that (r stays fixed at the pill's own radius rather than growing with
   it). Gives point + outward normal at any distance t around the full
   perimeter (`at`), or restricted to just the straight top/bottom edges
   (`atStraight`) so stations only ever land on those two rows — never the
   curved caps, and never the vertical sides even once those have length
   (they're reserved for branches that grow into the loop). */
function racetrack(x0, y0, x1, y1, r){
  const segs = [];
  const lineSegs = [];   // top + bottom only — the station-eligible rows
  let tCursor = 0;
  const line = (ax, ay, bx, by, nx, ny, isRow) => {
    const len = Math.hypot(bx-ax, by-ay);
    const seg = { t:"L", ax, ay, bx, by, nx, ny, len, tStart:tCursor };
    segs.push(seg);
    if (isRow) lineSegs.push(seg);
    tCursor += len;
  };
  const arc = (cx, cy, a0, a1) => {
    const len = r * Math.abs(a1 - a0);
    segs.push({ t:"A", cx, cy, r, a0, a1, len });
    tCursor += len;
  };
  const D = Math.PI / 180;

  line(x0+r, y0, x1-r, y0,  0, -1, true);    // top row
  arc (x1-r, y0+r, -90*D, 0);
  line(x1, y0+r, x1, y1-r,  1,  0, false);   // right side — no stations
  arc (x1-r, y1-r, 0, 90*D);
  line(x1-r, y1, x0+r, y1,  0,  1, true);    // bottom row
  arc (x0+r, y1-r, 90*D, 180*D);
  line(x0, y1-r, x0, y0+r, -1,  0, false);   // left side — no stations
  arc (x0+r, y0+r, 180*D, 270*D);

  const total = tCursor;
  const straightTotal = lineSegs.reduce((s, g) => s + g.len, 0);

  function at(t){
    t = ((t % total) + total) % total;
    for (const g of segs){
      if (t <= g.len || g === segs[segs.length-1]){
        const u = Math.min(1, g.len ? t / g.len : 0);
        if (g.t === "L")
          return { x:g.ax + (g.bx-g.ax)*u, y:g.ay + (g.by-g.ay)*u, nx:g.nx, ny:g.ny };
        const a = g.a0 + (g.a1 - g.a0) * u;
        return { x:g.cx + Math.cos(a)*g.r, y:g.cy + Math.sin(a)*g.r,
                 nx:Math.cos(a), ny:Math.sin(a) };
      }
      t -= g.len;
    }
  }

  /* Same idea, but the parameter only walks the straight edges (skipping
     the curved caps entirely), so every station gets a clean axis-aligned
     normal. Also returns the true perimeter offset `t` for path-drawing. */
  function atStraight(s){
    s = straightTotal ? ((s % straightTotal) + straightTotal) % straightTotal : 0;
    for (const g of lineSegs){
      if (s <= g.len || g === lineSegs[lineSegs.length-1]){
        const u = g.len ? s / g.len : 0;
        return { x:g.ax + (g.bx-g.ax)*u, y:g.ay + (g.by-g.ay)*u, nx:g.nx, ny:g.ny, t:g.tStart + s };
      }
      s -= g.len;
    }
  }

  /* Path string for the stretch of perimeter between t0 and t1. */
  function path(t0, t1){
    const F = n => n.toFixed(2);
    const p0 = at(t0);
    let d = `M ${F(p0.x)} ${F(p0.y)}`, walked = 0;
    for (const g of segs){
      const s = walked, e = walked + g.len;
      walked = e;
      const a = Math.max(t0, s), b = Math.min(t1, e);
      if (b - a <= 0.01) continue;
      if (g.t === "L"){
        const u = (b - s) / g.len;
        d += ` L ${F(g.ax + (g.bx-g.ax)*u)} ${F(g.ay + (g.by-g.ay)*u)}`;
      } else {
        const ua = (a - s) / g.len, ub = (b - s) / g.len;
        const aa = g.a0 + (g.a1-g.a0)*ua, ab = g.a0 + (g.a1-g.a0)*ub;
        const large = Math.abs(ab - aa) > Math.PI ? 1 : 0;
        d += ` A ${F(g.r)} ${F(g.r)} 0 ${large} 1 ` +
             `${F(g.cx + Math.cos(ab)*g.r)} ${F(g.cy + Math.sin(ab)*g.r)}`;
      }
    }
    return d;
  }

  return { total, straightTotal, at, atStraight, path };
}

/* ============================================================== the renderer
   Returns { svg, width, height }. All paint attributes are inline so the
   serialised SVG stands alone for download / PNG conversion. */
function buildDiagram(cfg){
  const { trunk, branches } = cfg;
  const colour = cfg.colour;
  const textColour = cfg.dark ? "#e8eaed" : STYLE.nameFill;
  const bgColour = cfg.dark ? "#15181c" : "#ffffff";
  const svg = el("svg", { xmlns:SVGNS, version:"1.1" });
  const defs     = el("defs", null, svg);
  const gLines   = el("g", { fill:"none", "stroke-linecap":"round", "stroke-linejoin":"round" }, svg);
  const gLabels  = el("g", { "font-family":FONT }, svg);
  const gMarkers = el("g", null, svg);
  const bb = makeBBox();
  const F2 = v => v.toFixed(2);
  let clipCounter = 0;
  const verticalLineXs = [0];       // x of every vertical line (trunk + branches), for centring
  const branchSideCount = { "-1":0, "1":0 };   // spaces out multiple branches on the same side

  /* ---- resolve nodes: trunk positions per layout, then branches ---- */
  const nodes = [];   // {code,name,ics,x,y,kind,label}
  const sp = cfg.spacing;
  const branchGap = cfg.branchSpacing || BRANCH_SPACING_DEFAULT[cfg.layout] || 120;

  /* label spec helpers -------------------------------------------------- */
  const DIAG  = { nameRot:-45, nameAnchor:"start", nameDX:0, nameDY:-13, codeDir:[0,1] };
  const RIGHT = { nameRot:0,   nameAnchor:"start",  codeDir:[1,0],  inline:true };
  const LEFT  = { nameRot:0,   nameAnchor:"end",    codeDir:[-1,0], inline:true };
  /* Same growth direction as DIAG (codes down) but the name reads
     horizontally, below the caplet family instead of diagonally above —
     used at a junction whose branch goes up, so the name doesn't run
     into the branch line's own path. */
  const BELOW = { nameRot:0, nameAnchor:"middle", codeDir:[0,1], inline:true };
  /* Loop stations always read name-above/codes-below, regardless of which
     side of the loop they sit on — name position is a fixed clearance
     above the caplet stack rather than growing with it. */
  const LOOPLABEL = { nameRot:0, nameAnchor:"middle", nameDX:0, nameDY:-(STYLE.codeH/2 + 12), codeDir:[0,1] };

  let trunkPath = "";            // path 'd' for the trunk
  let loop = null;               // stadium geometry, when layout === 'loop'
  let loopW = 0;                 // loop's full width, needed later for branch placement

  /* For horizontal/loop layouts, both trunk gaps flanking a junction station
     are widened to 1.5x, so the branch's own curve has room to come off
     cleanly instead of cramming into a normal-width gap — always split
     evenly on both sides regardless of which way the branch grows.
     `gapUnits[i]` is 1 or 1.5, the size (in multiples of `sp`) of the gap
     AFTER trunk station i (wrapping around for loops). */
  const keyOf = st => (st.code || st.name || "").toUpperCase();
  const junctionKeys = new Set(branches.map(b => b.from.toUpperCase()));
  const gapAfter = (i, wrap) => {
    const j = wrap ? (i + 1) % trunk.length : i + 1;
    if (j >= trunk.length || j < 0) return 1;
    const curKey = keyOf(trunk[i]), nextKey = keyOf(trunk[j]);
    return (junctionKeys.has(curKey) || junctionKeys.has(nextKey)) ? 1.5 : 1;
  };

  if (cfg.layout === "loop"){
    const n = Math.max(trunk.length, 2);
    const gapUnits = trunk.length ? trunk.map((st, i) => gapAfter(i, true)) : [1, 1];
    const totalUnits = gapUnits.reduce((a, u) => a + u, 0);
    /* r stays fixed at the pill's own radius (half the *base* height) even
       if the shape later grows taller — that's what turns a stadium/pill
       into a genuine rounded rect instead of just a bigger pill. Row length
       only depends on W and r, never on H, so this can all be worked out
       before H is finalised. */
    const baseH = Math.max(sp * 2, 200);
    const r = baseH / 2;
    const W = (totalUnits * sp) / 2 + baseH;
    loopW = W;
    const rowLen = W - 2 * r;             // top row length == bottom row length
    const rowTotal = rowLen * 2;
    const stepUnit = rowTotal / totalUnits;
    const positions = [];
    let cum = 0;
    trunk.forEach((st, i) => { positions.push(cum); cum += gapUnits[i] * stepUnit; });

    /* The loop only needs to grow taller (into a rounded rect) when some
       branch is explicitly pointed the opposite way from its junction's
       natural outward side — i.e. it grows into the loop's interior rather
       than away from it — so there's room for its own row without crowding
       the loop's far edge. */
    let needsExpand = false;
    branches.forEach(b => {
      if (!b.dir) return;   // no explicit direction -> always outward, unaffected
      const idx = trunk.findIndex(st => keyOf(st) === b.from.toUpperCase());
      if (idx < 0) return;
      const pos = ((positions[idx] % rowTotal) + rowTotal) % rowTotal;
      const defaultSgn = pos < rowLen ? -1 : 1;   // top row points up, bottom row points down
      const reqSgn = b.dir === "up" ? -1 : b.dir === "down" ? 1 : defaultSgn;
      if (reqSgn !== defaultSgn) needsExpand = true;
    });
    const H = needsExpand ? Math.max(baseH, 2 * branchGap) : baseH;
    loop = racetrack(0, 0, W, H, r);
    /* No station sits on the semicircular end-caps, so nothing else would
       ever feed their outer extent into the bounding box — without this
       they get clipped out of the viewBox. */
    bb.add(0, 0); bb.add(W, H);

    trunk.forEach((st, i) => {
      const p = loop.atStraight(positions[i]);
      nodes.push({ ...st, x:p.x, y:p.y, nx:p.nx, ny:p.ny, colour,
                   kind: cfg.closed ? "" : (i === 0 || i === trunk.length-1 ? "term" : ""),
                   label: LOOPLABEL });
    });
    trunkPath = cfg.closed
      ? loop.path(0, loop.total)
      : loop.path(0, loop.atStraight(positions[trunk.length - 1]).t);

  } else if (cfg.layout === "vertical"){
    trunk.forEach((st, i) => {
      nodes.push({ ...st, x:0, y:i * sp, colour, label:RIGHT,
                   kind: (i === 0 || i === trunk.length-1) ? "term" : "" });
    });
    trunkPath = `M 0 0 L 0 ${((trunk.length-1)*sp).toFixed(2)}`;

  } else { /* horizontal */
    let x = 0;
    trunk.forEach((st, i) => {
      if (i > 0) x += gapAfter(i - 1, false) * sp;
      nodes.push({ ...st, x, y:0, colour, label:DIAG,
                   kind: (i === 0 || i === trunk.length-1) ? "term" : "" });
    });
    trunkPath = `M 0 0 L ${(nodes.length ? nodes[nodes.length-1].x : 0).toFixed(2)} 0`;
  }

  const trunkCount = nodes.length;
  el("path", { d:trunkPath, stroke:colour, "stroke-width":STYLE.lineWidth }, gLines);

  /* ---- branches: smooth curve (or orthogonal turn) out of the trunk ---- */
  const warnings = [];
  const drawBranchLine = (d, strokeColour, shuttle) => {
    el("path", { d, stroke:strokeColour, "stroke-width":STYLE.lineWidth }, gLines);
    if (shuttle) el("path", { d, stroke:bgColour, "stroke-width":2.5 }, gLines);
  };
  branches.forEach(b => {
    if (!b.stations.length) return;
    const key = b.from.toUpperCase();
    let j = nodes.findIndex((n, i) => i < trunkCount &&
      ((n.code || "").toUpperCase() === key || (n.name || "").toUpperCase() === key));
    if (j < 0){
      warnings.push(`Branch junction “${b.from}” not found — attached to the last station instead.`);
      j = trunkCount - 1;
    }
    const jn = nodes[j];
    const bc = b.colour || colour;
    const gap = branchGap;
    const run = Math.max(sp * 1.6, 130);   // length of the smooth curve / straight run near the junction
    const shuttle = b.mode === "shuttle";
    const F = v => v.toFixed(2);

    /* shuttle mode: if a caplet label was explicitly given, the junction
       becomes an "interchange" showing it as an extra caplet. Without one,
       the junction just keeps its own code — some shuttles (e.g. Tengah)
       aren't shown as an interchange at all in real life. A shuttle caplet
       is still the same physical line, just a shuttle spur of it — not a
       separate interchanging line — so it's tracked separately and kept
       out of the legend even when it doesn't happen to share a LINE_INFO
       name with the current line. */
    if (shuttle){
      const label = (b.shuttleLabel || "").trim();
      if (label){
        jn.ics = [...jn.ics, label];
        jn.shuttleIcs = [...(jn.shuttleIcs || []), label];
      }
    }

    if (cfg.layout === "loop"){
      /* shoot out (or, if b.dir explicitly says otherwise, in toward the
         loop's own interior — the H-expansion above already made room)
         then turn to run parallel with the loop's own left-to-right
         station order, aligned station-for-station with the trunk stations
         past the junction (both flanking gaps got widened to 1.5x above,
         so there's already room for the curve on either side). Default
         growth direction matches which way the trunk itself continues. */
      const defaultSgn = jn.ny < 0 ? -1 : 1;
      const sgn = b.dir === "up" ? -1 : b.dir === "down" ? 1 : defaultSgn;
      const trunkNeighbour = j + 1 < trunkCount ? nodes[j + 1] : nodes[j - 1];
      const trunkDir = trunkNeighbour ? (trunkNeighbour.x >= jn.x ? 1 : -1) : 1;
      const turnDir = b.grow ? (b.grow === "left" ? -1 : 1) : trunkDir;
      const by = jn.y + sgn * gap;
      /* an orthogonal branch shoots straight up from a top-half junction —
         right through where the name normally sits (fixed above the
         caplets) — so drop the name below the caplets instead */
      if (b.curve === "orthogonal" && sgn < 0) jn.label = BELOW;
      const x1 = jn.x + turnDir * 1.5 * sp;
      const dist = Math.abs(x1 - jn.x);
      b.stations.forEach((st, i) => {
        nodes.push({ ...st, x:x1 + turnDir * i * sp, y:by, colour:bc, label:LOOPLABEL,
                     kind: i === b.stations.length-1 ? "term" : "", branch:b });
      });
      const lastX = x1 + turnDir * (b.stations.length-1) * sp;
      const d = b.curve === "orthogonal"
        ? roundedPath([[jn.x, jn.y], [jn.x, by], [lastX, by]], 56)
        : (() => {
            /* both tangents stay horizontal (matching the loop's own
               left-to-right reading direction) so the branch reads as a
               smooth lane-change off the loop rather than a rounded
               right-angle turn. Short straight insets at both ends —
               leaving the junction and landing on the first branch
               caplet — keep the bend itself clear of both caplets and,
               importantly, clear of the first branch station's own name
               text sitting just above it. */
            const inset = Math.min(20, dist * 0.3);
            const sx = jn.x + turnDir * inset;
            const ex = x1 - turnDir * inset;
            const distMid = Math.abs(ex - sx);
            const c1x = sx + turnDir*distMid*0.5, c1y = jn.y;
            const c2x = ex - turnDir*distMid*0.5, c2y = by;
            return `M ${F(jn.x)} ${F(jn.y)} L ${F(sx)} ${F(jn.y)} ` +
                   `C ${F(c1x)} ${F(c1y)}, ${F(c2x)} ${F(c2y)}, ${F(ex)} ${F(by)} L ${F(x1)} ${F(by)} L ${F(lastX)} ${F(by)}`;
          })();
      drawBranchLine(d, bc, shuttle);

    } else if (cfg.layout === "vertical"){
      jn.label = (b.dir === "left") ? RIGHT : LEFT;
      const sgn = b.dir === "left" ? -1 : 1;
      branchSideCount[sgn] = (branchSideCount[sgn] || 0) + 1;
      const bx = jn.x + sgn * gap * branchSideCount[sgn];
      verticalLineXs.push(bx);
      const y1 = jn.y + run;
      b.stations.forEach((st, i) => {
        nodes.push({ ...st, x:bx, y:y1 + i * sp, colour:bc,
                     label: sgn < 0 ? LEFT : RIGHT,
                     kind: i === b.stations.length-1 ? "term" : "", branch:b });
      });
      const lastY = y1 + (b.stations.length-1)*sp;
      const d = b.curve === "orthogonal"
        ? roundedPath([[jn.x, jn.y], [bx, jn.y], [bx, lastY]], 56)
        : (() => {
            /* short straight insets at both ends — leaving the junction and
               landing on the first branch station — so the bend doesn't
               start right at the junction's own caplet or run right into
               the first branch caplet either. */
            const inset = Math.min(20, run * 0.3);
            const sy = jn.y + inset;
            const ey = y1 - inset;
            const runMid = Math.max(ey - sy, 1);
            const c1y = sy + runMid*0.6, c2y = ey - runMid*0.4;
            return `M ${F(jn.x)} ${F(jn.y)} L ${F(jn.x)} ${F(sy)} ` +
                   `C ${F(jn.x)} ${F(c1y)}, ${F(bx)} ${F(c2y)}, ${F(bx)} ${F(ey)} L ${F(bx)} ${F(y1)} L ${F(bx)} ${F(lastY)}`;
          })();
      drawBranchLine(d, bc, shuttle);

    } else { /* horizontal */
      if (b.dir === "up") jn.label = BELOW;   // keep the name clear of the branch line above
      const sgn = b.dir === "up" ? -1 : 1;
      const growSgn = b.grow === "left" ? -1 : 1;
      const by = jn.y + sgn * gap;
      /* aligned station-for-station with the trunk stations past the
         junction (both flanking gaps got widened to 1.5x above) */
      const x1 = jn.x + growSgn * 1.5 * sp;
      const dist = Math.abs(x1 - jn.x);
      b.stations.forEach((st, i) => {
        nodes.push({ ...st, x:x1 + growSgn * i * sp, y:by, colour:bc, label:DIAG,
                     kind: i === b.stations.length-1 ? "term" : "", branch:b });
      });
      const lastX = x1 + growSgn * (b.stations.length-1)*sp;
      const d = b.curve === "orthogonal"
        ? roundedPath([[jn.x, jn.y], [jn.x, by], [lastX, by]], 56)
        : (() => {
            /* short straight insets at both ends — leaving the junction and
               landing on the first branch station — so the bend doesn't
               start right at the junction's own caplet or run right into
               the first branch caplet either. */
            const inset = Math.min(20, dist * 0.3);
            const sx = jn.x + growSgn * inset;
            const ex = x1 - growSgn * inset;
            const distMid = Math.abs(ex - sx);
            const c1x = sx + growSgn*distMid*0.5, c2x = ex - growSgn*distMid*0.5;
            return `M ${F(jn.x)} ${F(jn.y)} L ${F(sx)} ${F(jn.y)} ` +
                   `C ${F(c1x)} ${F(jn.y)}, ${F(c2x)} ${F(by)}, ${F(ex)} ${F(by)} L ${F(x1)} ${F(by)} L ${F(lastX)} ${F(by)}`;
          })();
      drawBranchLine(d, bc, shuttle);
    }
  });

  /* ---- labels + markers: the station-code caplet doubles as the marker ---- */
  nodes.forEach(n => {
    const L = n.label;
    const codes = [];
    if (cfg.showCodes && n.code) codes.push({ t:n.code, c:n.colour });
    if (cfg.showIc) n.ics.forEach(c => {
      const osi = /\*$/.test(c);              // trailing * marks an out-of-station interchange
      const t = osi ? c.slice(0, -1) : c;
      codes.push({ t, c:colourForCode(t, n.colour), osi });
    });

    const dir = L.codeDir;
    const horiz = Math.abs(dir[0]) > Math.abs(dir[1]);
    const h = STYLE.codeH;
    let codesExtent = 0;

    const OSI_GAP = 12;   // gap that stands an out-of-station code apart, bridged by a connector line

    if (codes.length && horiz){
      /* Vertical layout: codes read left-to-right. A merged pill per
         contiguous, colour-banded run — the station's own code (codes[0])
         sits centred straddling the line; interchange codes grow off the
         opposite side from the station name so they never collide. An
         out-of-station interchange breaks off into its own pill, joined
         by a short connector line instead of touching directly. */
      const widths = codes.map(cd => codeBoxW(cd.t));
      const w0 = widths[0];
      const growDir = -dir[0];   // grow opposite the name's side
      const segs = [{ cd:codes[0], x0:n.x - w0/2, x1:n.x + w0/2 }];
      let edge = growDir >= 0 ? n.x + w0/2 : n.x - w0/2;
      for (let i = 1; i < codes.length; i++){
        const w = widths[i], gap = codes[i].osi ? OSI_GAP : 0;
        let sx0, sx1;
        if (growDir >= 0){ sx0 = edge + gap; sx1 = sx0 + w; edge = sx1; }
        else { sx1 = edge - gap; sx0 = sx1 - w; edge = sx0; }
        segs.push({ cd:codes[i], x0:sx0, x1:sx1 });
      }
      const y0 = n.y - h/2;
      const runs = [[segs[0]]];
      for (let i = 1; i < segs.length; i++){
        if (segs[i].cd.osi) runs.push([segs[i]]); else runs[runs.length-1].push(segs[i]);
      }
      runs.forEach(run => {
        const rx0 = Math.min(...run.map(s => s.x0)), rx1 = Math.max(...run.map(s => s.x1));
        clipCounter++;
        const clipId = `cap-clip-${clipCounter}`;
        const clip = el("clipPath", { id:clipId }, defs);
        el("rect", { x:F2(rx0), y:F2(y0), width:F2(rx1-rx0), height:F2(h), rx:F2(h/2) }, clip);
        const grp = el("g", { "clip-path":`url(#${clipId})` }, gLabels);
        run.forEach((s, i) => {
          el("rect", { x:F2(s.x0), y:F2(y0), width:F2(s.x1-s.x0), height:F2(h), fill:s.cd.c }, grp);
          if (i > 0) el("rect", { x:F2(s.x0-.75), y:F2(y0), width:1.5, height:F2(h), fill:bgColour }, grp);
          const tx = el("text", { x:F2((s.x0+s.x1)/2), y:F2(n.y+3.9), "text-anchor":"middle",
                                  "font-size":STYLE.codeSize, "font-weight":700, fill:contrastText(s.cd.c),
                                  "letter-spacing":".3" }, gLabels);
          setCodeText(tx, s.cd.t, STYLE.codeSize);
        });
        el("rect", { x:F2(rx0), y:F2(y0), width:F2(rx1-rx0), height:F2(h), rx:F2(h/2), fill:"none",
                     stroke:bgColour, "stroke-width":STYLE.capletOutlineW }, gLabels);
        bb.rect(rx0, y0, rx1-rx0, h);
      });
      for (let i = 1; i < runs.length; i++){
        const a = runs[i-1][runs[i-1].length-1], b = runs[i][0];
        const aFirst = a.x1 <= b.x0;
        const gx0 = aFirst ? a.x1 : b.x1, gx1 = aFirst ? b.x0 : a.x0;
        drawOsiConnector(el, gLabels, gx0, n.y, gx1, n.y, 5,
                          aFirst ? a.cd.c : b.cd.c, aFirst ? b.cd.c : a.cd.c);
      }
      codesExtent = w0 / 2;   // name sits opposite the ICs, only needs to clear the own-code segment

    } else if (codes.length){
      /* Horizontal/loop layout: each code gets its own separate pill-shaped
         caplet — the station's own line (codes[0]) sits centred straddling
         the line; interchange codes stack outward, abutting the previous
         one with no gap (or, for an out-of-station interchange, a short
         gap bridged by a connector line). */
      let edge = n.y;
      codes.forEach((cd, idx) => {
        const w = codeBoxW(cd.t);
        let cy;
        if (idx === 0){ cy = n.y; edge = n.y + dir[1]*(h/2); }
        else {
          const gapStart = edge;
          edge = edge + dir[1]*(cd.osi ? OSI_GAP : 0);
          cy = edge + dir[1]*(h/2);
          if (cd.osi) drawOsiConnector(el, gLabels, n.x, gapStart, n.x, edge, 5, codes[idx-1].c, cd.c);
          edge = edge + dir[1]*h;
        }
        const cx = n.x;
        el("rect", { x:F2(cx - w/2), y:F2(cy - h/2), width:F2(w), height:F2(h), rx:F2(h/2),
                     fill:cd.c, stroke:bgColour, "stroke-width":STYLE.capletOutlineW }, gLabels);
        const tx = el("text", { x:F2(cx), y:F2(cy + 3.9), "text-anchor":"middle",
                                "font-size":STYLE.codeSize, "font-weight":700, fill:contrastText(cd.c),
                                "letter-spacing":".3" }, gLabels);
        setCodeText(tx, cd.t, STYLE.codeSize);
        bb.rect(cx - w/2 - 1, cy - h/2 - 1, w + 2, h + 2);
      });
      codesExtent = Math.abs(edge - n.y);
    }

    /* station name */
    if (n.name){
      let nx, ny;
      if (L.inline){
        const d = (codesExtent || STYLE.codeGap) + 14;
        if (L.nameAnchor === "middle"){
          nx = n.x;
          ny = n.y + dir[1] * d + (dir[1] > 0 ? STYLE.nameSize * 0.85 : 0);
        } else {
          nx = n.x + dir[0] * d;
          ny = n.y + dir[1] * d + (horiz ? 4.6 : 0);
        }
      } else {
        nx = n.x + (L.nameDX || 0);
        ny = n.y + (L.nameDY || 0);
      }

      /* Loop names read horizontally and can run into neighbouring
         stations, so long ones wrap onto two lines, stacked upward from
         the usual single-line position (name always sits above the
         caplet in loop layout). */
      const lines = cfg.layout === "loop" ? wrapName(n.name, 12) : [n.name];
      const lineHeight = STYLE.nameSize * 1.15;
      lines.forEach((lineText, li) => {
        const ly = ny - (lines.length - 1 - li) * lineHeight;
        const t = el("text", {
          x:F2(nx), y:F2(ly),
          "text-anchor":L.nameAnchor,
          "font-size":STYLE.nameSize,
          "font-weight":STYLE.nameWeight,
          fill:textColour,
          transform: L.nameRot ? `rotate(${L.nameRot} ${F2(nx)} ${F2(ly)})` : null
        }, gLabels);
        t.textContent = lineText;
        bb.text(nx, ly, lineText, STYLE.nameSize, L.nameRot, L.nameAnchor);
      });
    }

    /* no code to show at all (rare) — a small tick stands in for a marker */
    if (!codes.length){
      const isIC = n.ics.length > 0;
      const tickLen = n.kind === "term" ? 16 : 10;
      const x1t = n.x - dir[0]*tickLen/2, y1t = n.y - dir[1]*tickLen/2;
      const x2t = n.x + dir[0]*tickLen/2, y2t = n.y + dir[1]*tickLen/2;
      el("line", { x1:F2(x1t), y1:F2(y1t), x2:F2(x2t), y2:F2(y2t),
                   stroke: isIC ? STYLE.icStroke : n.colour,
                   "stroke-width": n.kind === "term" ? 5 : 3.5, "stroke-linecap":"round" }, gMarkers);
      bb.add(n.x - tickLen, n.y - tickLen);
      bb.add(n.x + tickLen, n.y + tickLen);
    }
  });

  if (!isFinite(bb.x0)) bb.rect(0, 0, 10, 10);

  if (cfg.layout === "vertical"){
    /* Every vertical line (trunk + each branch) sits with labels only
       extending to one side, which would leave the lines off-centre —
       pad the shorter side so the *centre of gravity* of all the lines
       together lands in the horizontal middle of the diagram, rather
       than just the trunk on its own. Done before the legend/badge so
       both anchor to the same (now re-centred) bounding box. */
    const centre = verticalLineXs.reduce((a, x) => a + x, 0) / verticalLineXs.length;
    const half = Math.max(centre - bb.x0, bb.x1 - centre);
    bb.x0 = centre - half; bb.x1 = centre + half;
  }

  /* ---- legend: every line referenced on this diagram (own line + any
     interchange codes seen), so a reader can identify what each colour means */
  const legendSeen = new Set(), legendItems = [];
  const pushLegend = (name, itemColour, acr) => {
    if (legendSeen.has(name)) return;
    legendSeen.add(name);
    legendItems.push({ name, colour:itemColour, acr });
  };
  /* the current line already has its own name/code/colour on the form —
     no need to guess it via the LINE_INFO prefix table */
  if (cfg.name || cfg.code) pushLegend(cfg.name || cfg.code, colour, cfg.code || cfg.name);
  if (cfg.showIc) nodes.forEach(n => n.ics.forEach(code => {
    if (n.shuttleIcs && n.shuttleIcs.includes(code)) return;   // shuttle spur of this same line, not a separate interchange
    const m = /^([A-Za-z]+)/.exec(code || "");
    const prefix = m ? m[1].toUpperCase() : (code || "").toUpperCase();
    const info = LINE_INFO[prefix];
    pushLegend((info && info.name) || code || "Line", (info && info.colour) || colour, (info && info.acr) || prefix);
  }));

  if (legendItems.length > 1 || (legendItems.length === 1 && cfg.code)){
    /* Caplets here match the diagram's own caplet proportions (same height
       and text size), just scaled to the legend's own label text size. */
    const legendTextSize = 11.5;
    const legendScale = legendTextSize / STYLE.nameSize;
    const lh = STYLE.codeH * legendScale;
    const capFont = STYLE.codeSize * legendScale;
    const g = el("g", { "font-family":FONT }, svg);
    let lx = bb.x0, ly = bb.y1 + 36;
    const rowMaxX = bb.x0 + Math.max(bb.x1 - bb.x0, 480);
    legendItems.forEach(it => {
      const capW = codeBoxW(it.acr) * legendScale;
      const w = capW + 8 + measure(it.name, legendTextSize) + 18;
      if (lx + w > rowMaxX && lx > bb.x0){ lx = bb.x0; ly += 26; }
      el("rect", { x:F2(lx), y:F2(ly - lh/2), width:F2(capW), height:F2(lh), rx:F2(lh/2), fill:it.colour }, g);
      const capText = el("text", { x:F2(lx + capW/2), y:F2(ly + lh*0.22), "text-anchor":"middle",
                                   "font-size":F2(capFont), "font-weight":700, fill:contrastText(it.colour), "letter-spacing":".3" }, g);
      capText.textContent = it.acr;
      const t = el("text", { x:F2(lx + capW + 8), y:F2(ly + 4.2), "font-size":legendTextSize, "font-weight":600,
                             fill:textColour }, g);
      t.textContent = it.name;
      bb.rect(lx, ly - lh/2, w - 6, lh);
      lx += w;
    });
  }

  /* ---- header badge ---- */
  if (cfg.showBadge && (cfg.name || cfg.code)){
    const g = el("g", { "font-family":FONT }, svg);
    const bx = bb.x0, by = bb.y0 - 58;
    let x = bx;
    if (cfg.code){
      const w = Math.max(42, cfg.code.length * 12 + 20);
      el("rect", { x:bx, y:by, width:w, height:36, rx:18, fill:colour }, g);
      const t = el("text", { x:bx + w/2, y:by + 24.5, "text-anchor":"middle",
                             "font-size":17, "font-weight":800, fill:contrastText(colour),
                             "letter-spacing":".5" }, g);
      t.textContent = cfg.code;
      bb.rect(bx, by, w, 36);
      x = bx + w + 13;
    }
    if (cfg.name){
      const t = el("text", { x:x, y:by + 25.5, "font-size":23, "font-weight":750,
                             fill:textColour, "letter-spacing":"-.01em" }, g);
      t.textContent = cfg.name;
      bb.text(x, by + 25.5, cfg.name, 23, 0, "start");
    }
  }

  /* ---- frame ---- */
  const pad = 26;
  const x0 = bb.x0 - pad, y0 = bb.y0 - pad;
  const w  = (bb.x1 - bb.x0) + pad*2, h = (bb.y1 - bb.y0) + pad*2;
  svg.setAttribute("viewBox", `${x0.toFixed(2)} ${y0.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
  svg.setAttribute("width", Math.ceil(w));
  svg.setAttribute("height", Math.ceil(h));
  if (cfg.opaque){
    const bg = el("rect", { x:x0, y:y0, width:w, height:h, fill: cfg.dark ? "#15181c" : "#ffffff" });
    svg.insertBefore(bg, svg.firstChild);
  }
  return { svg, width:w, height:h, warnings };
}

/* ================================================================== the app */
const $ = id => document.getElementById(id);
const S = {
  spec:$("spec"), name:$("lineName"), code:$("lineCode"), colour:$("lineColor"),
  hex:$("colorHex"), layout:$("layout"), spacing:$("spacing"), branchSpacing:$("branchSpacing"),
  closed:$("closed"), showCodes:$("showCodes"), showIc:$("showIc"),
  showBadge:$("showBadge"), opaque:$("opaque")
};
let zoom = 1, current = null;
let diagramDark = false;   // the diagram's own light/dark background, independent of the app UI theme

/* Quick spacing presets shown as buttons — vertical lists read comfortably
   tighter than horizontal/loop layouts, hence the different values. */
const SPACING_PRESETS = { horizontal:[60,80,100], loop:[60,80,100], vertical:[40,60,80] };
const SPACING_DEFAULT = { horizontal:60, vertical:40, loop:100 };

/* Branch spacing: how far a branch's line sits from the trunk it splits
   off from. Same idea as station spacing, just perpendicular to the
   trunk rather than along it — vertical layouts need more room since the
   branch runs alongside station-name text. */
const BRANCH_SPACING_PRESETS = { horizontal:[90,120,150], loop:[90,120,150], vertical:[180,240,300] };
const BRANCH_SPACING_DEFAULT = { horizontal:120, vertical:240, loop:120 };

function renderPresetButtons(row, list, field, onPick){
  row.innerHTML = "";
  list.forEach(v => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "spacingBtn" + (String(v) === String(field.value) ? " active" : "");
    b.textContent = v;
    b.onclick = () => { field.value = v; onPick(); render(); };
    row.appendChild(b);
  });
}
function renderSpacingButtons(){
  renderPresetButtons($("spacingRow"), SPACING_PRESETS[S.layout.value] || SPACING_PRESETS.horizontal,
    S.spacing, renderSpacingButtons);
}
function renderBranchSpacingButtons(){
  renderPresetButtons($("branchSpacingRow"), BRANCH_SPACING_PRESETS[S.layout.value] || BRANCH_SPACING_PRESETS.horizontal,
    S.branchSpacing, renderBranchSpacingButtons);
}

/* The NS/EW/CC/... -> {name,colour,acr} table is user-editable at runtime.
   Prefixes belonging to the same line (e.g. EW+CG for the East-West Line,
   or JS+JW+JE for the Jurong Region Line) are grouped under one shared
   name/acronym/colour so editing one updates every prefix in the group at
   once, instead of repeating identical rows per prefix. Grouping is purely
   a rendering concern — LINE_INFO itself stays a flat prefix -> info map,
   so it still round-trips through save()/JSON export unchanged. */
function renderLineInfoRows(){
  const container = $("lineInfoRows");
  container.innerHTML = "";

  const groups = new Map();   // name -> { name, colour, acr, prefixes:[] }
  Object.keys(LINE_INFO).sort().forEach(prefix => {
    const info = LINE_INFO[prefix];
    const key = info.name || prefix;
    if (!groups.has(key)) groups.set(key, { name:info.name, colour:info.colour, acr:info.acr, prefixes:[] });
    groups.get(key).prefixes.push(prefix);
  });

  const setAll = (group, patch) => {
    group.prefixes.forEach(p => Object.assign(LINE_INFO[p], patch));
  };

  [...groups.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach(group => {
    const box = document.createElement("div");
    box.className = "liGroup";

    const head = document.createElement("div");
    head.className = "liRow";

    const nameInp = document.createElement("input");
    nameInp.className = "liName"; nameInp.placeholder = "Line name"; nameInp.value = group.name || "";
    nameInp.oninput = () => { setAll(group, { name:nameInp.value }); render(); };
    head.appendChild(nameInp);

    const acrInp = document.createElement("input");
    acrInp.className = "liAcr"; acrInp.placeholder = "NSL"; acrInp.value = group.acr || "";
    acrInp.oninput = () => { setAll(group, { acr:acrInp.value.trim() }); render(); };
    head.appendChild(acrInp);

    const colourInp = document.createElement("input");
    colourInp.type = "color"; colourInp.value = group.colour || "#8a9099";
    colourInp.title = "Colour"; colourInp.oninput = () => { setAll(group, { colour:colourInp.value }); render(); };
    head.appendChild(colourInp);

    const delGroup = document.createElement("button");
    delGroup.type = "button"; delGroup.className = "rowDel"; delGroup.textContent = "✕";
    delGroup.title = "Remove this line and all its prefixes";
    delGroup.onclick = () => {
      group.prefixes.forEach(p => delete LINE_INFO[p]);
      renderLineInfoRows(); render();
    };
    head.appendChild(delGroup);
    box.appendChild(head);

    const chips = document.createElement("div");
    chips.className = "liChips";
    group.prefixes.forEach(prefix => {
      const chip = document.createElement("span");
      chip.className = "liChip";
      chip.append(prefix);
      const chipDel = document.createElement("button");
      chipDel.type = "button"; chipDel.textContent = "×"; chipDel.title = "Remove prefix " + prefix;
      chipDel.onclick = () => { delete LINE_INFO[prefix]; renderLineInfoRows(); render(); };
      chip.appendChild(chipDel);
      chips.appendChild(chip);
    });

    const addInp = document.createElement("input");
    addInp.className = "liAddPrefix"; addInp.placeholder = "+ prefix";
    addInp.onchange = () => {
      const next = addInp.value.trim().toUpperCase();
      addInp.value = "";
      if (!next || LINE_INFO[next]) return;
      LINE_INFO[next] = { name:group.name, colour:group.colour, acr:group.acr };
      renderLineInfoRows(); render();
    };
    chips.appendChild(addInp);
    box.appendChild(chips);

    container.appendChild(box);
  });
}

/* Preset picker metadata — drives the little coloured line-acronym caplets
   at the top of the sidebar. `key` looks up EXAMPLES. Grouped into the
   categories LTA/operators actually use: Current (open today), Future
   (under construction, dated), and Proposed (advocacy/concept lines —
   e.g. the Singapore Transport Collective's Transport Manifesto 50 —
   added once that data is provided). */
const PRESET_GROUPS = [
  { name:"Current", items:[
    { key:"ns", acr:"NSL", label:"North-South Line",  colour:"#d42e12" },
    { key:"ew", acr:"EWL", label:"East-West Line",     colour:"#009645" },
    { key:"cc", acr:"CCL", label:"Circle Line",        colour:"#fa9e0d" },
    { key:"ne", acr:"NEL", label:"North East Line",    colour:"#9900aa" },
    { key:"dt", acr:"DTL", label:"Downtown Line",      colour:"#005ec4" },
    { key:"te", acr:"TEL", label:"Thomson-East Coast Line", colour:"#9d5b25" },
  ]},
  { name:"Future", items:[
    { key:"jrl", acr:"JRL", label:"Jurong Region Line", colour:"#0099aa" },
    { key:"crl", acr:"CRL", label:"Cross Island Line",  colour:"#97c616" },
  ]},
  { name:"Proposed", items:[
    { key:"stl", acr:"STL", label:"Seletar-Tengah Line", colour:"#e8467c" },
  ]},
  { name:"Other", items:[
    { key:"blank", acr:"—", label:"Blank template", colour:"#8a9099" }
  ]}
];

const EXAMPLES = {
  ns:{
    name:"North-South Line", code:"NSL", colour:"#d42e12", layout:"horizontal",
    spec:`NS1  Jurong East        > EW24
NS2  Bukit Batok
NS3  Bukit Gombak
NS4  Choa Chu Kang      > BP1
NS5  Yew Tee
NS7  Kranji
NS8  Marsiling
NS9  Woodlands          > TE2
NS10 Admiralty
NS11 Sembawang
NS12 Canberra
NS13 Yishun
NS14 Khatib
NS15 Yio Chu Kang
NS16 Ang Mo Kio
NS17 Bishan             > CC15
NS18 Braddell
NS19 Toa Payoh
NS20 Novena
NS21 Newton             > DT11*
NS22 Orchard            > TE14
NS23 Somerset
NS24 Dhoby Ghaut        > NE6, CC1
NS25 City Hall          > EW13
NS26 Raffles Place      > EW14
NS27 Marina Bay         > CC33, TE20
NS28 Marina South Pier`
  },
  ew:{
    name:"East-West Line", code:"EWL", colour:"#009645", layout:"horizontal",
    spec:`EW33 Tuas Link
EW32 Tuas West Road
EW31 Tuas Crescent
EW30 Gul Circle
EW29 Joo Koon
EW28 Pioneer
EW27 Boon Lay
EW26 Lakeside
EW25 Chinese Garden
EW24 Jurong East        > NS1
EW23 Clementi
EW22 Dover
EW21 Buona Vista        > CC22
EW20 Commonwealth
EW19 Queenstown
EW18 Redhill
EW17 Tiong Bahru
EW16 Outram Park        > NE3, TE17
EW15 Tanjong Pagar
EW14 Raffles Place      > NS26
EW13 City Hall          > NS25
EW12 Bugis              > DT14
EW11 Lavender
EW10 Kallang
EW9  Aljunied
EW8  Paya Lebar         > CC9
EW7  Eunos
EW6  Kembangan
EW5  Bedok
EW4  Tanah Merah
EW3  Simei
EW2  Tampines           > DT32*
EW1  Pasir Ris

[branch from EW4 down shuttle CG]
CG1  Expo               > DT35
CG2  Changi Airport`
  },
  cc:{
    /* Circle Line Stage 6 (Keppel / Cantonment / Prince Edward Road) opened
       12 Jul 2026, closing the loop and renumbering the old Marina Bay spur
       (CE1/CE2) into CC33/CC34. Trunk starts at Haw Par Villa (CC25) and
       reads CC25→CC24→…→CC4→CC34→…→CC26→ back to CC25; Dhoby Ghaut/Bras
       Basah/Esplanade (CC1-CC3) are a short spur off Promenade (CC4) — a
       real example of a loop layout with a branch. */
    name:"Circle Line", code:"CCL", colour:"#fa9e0d", layout:"loop", spacing:104, closed:true,
    spec:`CC25 Haw Par Villa
CC24 Kent Ridge
CC23 one-north
CC22 Buona Vista        > EW21
CC21 Holland Village
CC20 Farrer Road
CC19 Botanic Gardens    > DT9
CC17 Caldecott          > TE9
CC16 Marymount
CC15 Bishan             > NS17
CC14 Lorong Chuan
CC13 Serangoon          > NE12
CC12 Bartley
CC11 Tai Seng
CC10 MacPherson         > DT26
CC9  Paya Lebar         > EW8
CC8  Dakota
CC7  Mountbatten
CC6  Stadium
CC5  Nicoll Highway
CC4  Promenade          > DT15
CC34 Bayfront           > DT16
CC33 Marina Bay         > NS27, TE20
CC32 Prince Edward Road
CC31 Cantonment
CC30 Keppel
CC29 HarbourFront       > NE1, EW17
CC28 Telok Blangah
CC27 Labrador Park
CC26 Pasir Panjang

[branch from CC4 up]
CC3  Esplanade
CC2  Bras Basah
CC1  Dhoby Ghaut        > NS24, NE6`
  },
  ne:{
    name:"North East Line", code:"NEL", colour:"#9900aa", layout:"horizontal",
    spec:`NE1  HarbourFront        > CC29
NE3  Outram Park        > EW16, TE17
NE4  Chinatown          > DT19
NE5  Clarke Quay
NE6  Dhoby Ghaut        > NS24, CC1
NE7  Little India       > DT12
NE8  Farrer Park
NE9  Boon Keng
NE10 Potong Pasir
NE11 Woodleigh
NE12 Serangoon          > CC13
NE13 Kovan
NE14 Hougang            > CR8
NE15 Buangkok
NE16 Sengkang           > STC
NE17 Punggol            > PTC
NE18 Punggol Coast`
  },
  dt:{
    name:"Downtown Line", code:"DTL", colour:"#005ec4", layout:"horizontal",
    spec:`DT1  Bukit Panjang      > BP6*
DT2  Cashew
DT3  Hillview
DT4  Hume
DT5  Beauty World
DT6  King Albert Park
DT7  Sixth Avenue
DT8  Tan Kah Kee
DT9  Botanic Gardens    > CC19
DT10 Stevens            > TE11
DT11 Newton             > NS21*
DT12 Little India       > NE7
DT13 Rochor
DT14 Bugis              > EW12
DT15 Promenade          > CC4
DT16 Bayfront           > CC34
DT17 Downtown
DT18 Telok Ayer
DT19 Chinatown          > NE4
DT20 Fort Canning
DT21 Bencoolen
DT22 Jalan Besar
DT23 Bendemeer
DT25 Geylang Bahru
DT26 MacPherson         > CC10
DT27 Ubi
DT28 Kaki Bukit
DT29 Bedok North
DT30 Bedok Reservoir
DT31 Tampines West
DT32 Tampines           > EW2*
DT33 Tampines East
DT34 Upper Changi
DT35 Expo               > CG1
# Xilin and Sungei Bedok are under construction, due 2H 2026
DT36 Xilin
DT37 Sungei Bedok       > TE31`
  },
  te:{
    name:"Thomson-East Coast Line", code:"TEL", colour:"#9d5b25", layout:"horizontal",
    spec:`TE1  Woodlands North     > RTS*
TE2  Woodlands          > NS9
TE3  Woodlands South
TE4  Springleaf
TE5  Lentor
TE6  Mayflower
TE7  Bright Hill
TE8  Upper Thomson
TE9  Caldecott          > CC17
TE10 Mount Pleasant
TE11 Stevens            > DT10
TE12 Napier
TE13 Orchard Boulevard
TE14 Orchard            > NS22
TE15 Great World
TE16 Havelock
TE17 Outram Park        > EW16, NE3
TE18 Maxwell
TE19 Shenton Way
TE20 Marina Bay         > NS27, CC33
TE21 Marina South
TE22 Gardens by the Bay
TE22A Founders' Memorial
TE23 Tanjong Rhu
TE24 Katong Park
TE25 Tanjong Katong
TE26 Marine Parade
TE27 Marine Terrace
TE28 Siglap
TE29 Bayshore
# Bedok South and Sungei Bedok are under testing, due 2H 2026
TE30 Bedok South
TE31 Sungei Bedok       > DT37`
  },
  stl:{
    /* SPECULATIVE — not an official LTA project. Transcribed from a fan
       concept map ("Tengah-Seletar Line", a speculative map based on LTA's
       Budget 2025, by @yuiurbanfantasy / @umiyuikaiteitan), renumbered ST
       to match "Seletar-Tengah" naming. Replace once official/more
       considered Transport Manifesto 50 alignment info is given. */
    name:"Seletar-Tengah Line", code:"STL", colour:"#e8467c", layout:"horizontal",
    spec:`# SPECULATIVE fan concept map, not an official LTA line — replace freely
ST1  Tengah              > JS3
ST2  Brickworks
ST3  Bukit Batok         > NS2
ST4  Burgundy
ST5  Maju                > CR16
ST6  Jelita
ST7  Buona Vista         > CC22, EW21
ST8  Alexandra
ST9  Bukit Merah
ST10 Cantonment          > CC31
ST11 Tanjong Pagar
ST12 Marina Bay          > CC33, TE20, NS27
ST13 Founders' Memorial  > TE22A
ST14 Stadium             > CC6
ST15 Kallang             > EW10
ST16 Boon Keng-Bendemeer > NE9, DT23
ST17 Whampoa
ST18 Toa Payoh West
ST19 Lorong Chuan        > CC14
ST20 Serangoon North     > CR9
ST21 Fernvale            > SW5
ST22 Seletar Airport
ST23 Yishun Valley
ST24 Montreal
ST25 Cochrane
ST26 Senoko
ST27 Woodlands North     > TE1, RTS*`
  },
  jrl:{
    /* Jurong Region Line — under construction, phased opening from mid-2028.
       JS is the trunk; JW (NTU spur) branches off Bahar Junction (JS7),
       while JE (Tengah/Jurong East spur) branches off Tengah (JS3) —
       a real two-branch example, each off a different junction. */
    name:"Jurong Region Line", code:"JRL", colour:"#0099aa", layout:"horizontal",
    spec:`# Under construction — JS/JW mid-2028, JE 2028, JS9-12/JW3-5 2029
JS1  Choa Chu Kang       > NS4, BP1
JS2  Choa Chu Kang West
JS3  Tengah
JS4  Hong Kah
JS5  Corporation
JS6  Jurong West
JS7  Bahar Junction
JS8  Boon Lay            > EW27
JS9  Enterprise
JS10 Tukang
JS11 Jurong Hill
JS12 Jurong Pier

[branch from JS7 down orthogonal]
JW1  Gek Poh
JW2  Tawas
JW3  Nanyang Gateway
JW4  Nanyang Crescent
JW5  Peng Kang Hill

[branch from JS3 up shuttle]
JE1  Tengah Plantation
JE2  Tengah Park
JE3  Bukit Batok West
JE4  Toh Guan
JE5  Jurong East         > NS1, EW24
JE6  Jurong Town Hall
JE7  Pandan Reservoir`
  },
  crl:{
    /* Cross Island Line — under construction. Phase 1 targeted 2030,
       Punggol Extension (CP, branching off Pasir Ris) 2032, Phase 2
       (Turf City onward) also targeted 2032. */
    name:"Cross Island Line", code:"CRL", colour:"#97c616", layout:"horizontal",
    spec:`# Under construction — Phase 1 target 2030, Punggol Extension & Phase 2 target 2032
CR19 Jurong Lake District
CR18 West Coast
CR17 Clementi            > EW23
CR16 Maju
CR15 King Albert Park    > DT6
CR14 Turf City
CR13 Bright Hill         > TE
CR12 Teck Ghee
CR11 Ang Mo Kio          > NS16
CR10 Tavistock
CR9  Serangoon North
CR8  Hougang             > NE14
CR7  Defu
CR6  Tampines North
CR5  Pasir Ris           > EW1
CR4  Pasir Ris East
CR3  Loyang
CR2  Aviation Park

[branch from CR5 down shuttle CP1]
CP2  Elias
CP3  Riviera             > PE4*
CP4  Punggol             > NE17, PTC`
  },
  blank:{
    name:"My Line", code:"ML", colour:"#005ec4", layout:"horizontal",
    spec:`# CODE  Station name  > interchange codes
ML1  First Station
ML2  Second Station     > NS1
ML3  Third Station
ML4  Fourth Station

[branch from ML2 down]
MB1  Branch Station One
MB2  Branch Terminus`
  }
};

/* --------------------------------------------------------------- read/write
   Two ways to edit the station list: a structured row-based Editor (the
   default), or raw Text. The Editor keeps its own live model — mutating it
   directly rather than re-parsing on every keystroke means row inputs never
   lose focus. Text mode just uses S.spec.value directly, like before;
   switching Editor -> Text serialises `live`, Text -> Editor re-parses it. */
let mode = "editor";                 // 'editor' | 'text'
let live = { trunk:[], branches:[] };
let dragCtx = null;

function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function stLineText(st){
  const code = (st.code || "").trim(), name = (st.name || "").trim();
  let s = code ? (name ? `${code} | ${name}` : code) : name;
  if (st.ics && st.ics.length) s += `  > ${st.ics.join(", ")}`;
  return s || "?";
}
function branchHeaderText(b){
  let s = `[branch from ${b.from || "?"}`;
  if (b.dir) s += ` ${b.dir}`;
  if (b.grow && b.grow !== b.dir) s += ` ${b.grow}`;
  if (b.mode === "shuttle") s += ` shuttle${b.shuttleLabel ? " " + b.shuttleLabel : ""}`;
  if (b.curve === "orthogonal" && b.mode !== "shuttle") s += " orthogonal";
  if (b.colour) s += `: ${b.colour}`;
  return s + "]";
}
function syncTextFromLive(){
  const lines = live.trunk.map(stLineText);
  live.branches.forEach(b => {
    lines.push("");
    lines.push(branchHeaderText(b));
    b.stations.forEach(st => lines.push(stLineText(st)));
  });
  S.spec.value = lines.join("\n");
}
function setLiveFromText(text){
  const parsed = parseSpec(text);
  live.trunk = parsed.trunk;
  live.branches = parsed.branches;
  return parsed.errors;
}

function currentTrunkBranches(){
  if (mode === "text"){
    const parsed = parseSpec(S.spec.value);
    return { trunk:parsed.trunk, branches:parsed.branches, errors:parsed.errors };
  }
  return { trunk:live.trunk, branches:live.branches, errors:[] };
}

function readForm(){
  const { trunk, branches, errors } = currentTrunkBranches();
  return {
    name:S.name.value.trim(), code:S.code.value.trim().toUpperCase(),
    colour:S.colour.value, layout:S.layout.value,
    spacing:parseInt(S.spacing.value, 10) || 100,
    branchSpacing:parseInt(S.branchSpacing.value, 10) || 120,
    closed:S.closed.checked, showCodes:S.showCodes.checked, showIc:S.showIc.checked,
    showBadge:S.showBadge.checked, opaque:S.opaque.checked,
    dark: diagramDark,
    trunk, branches, errors
  };
}

function applyConfig(c){
  S.name.value = c.name || "";
  S.code.value = c.code || "";
  setColour(c.colour || "#005ec4");
  S.layout.value = c.layout || "horizontal";
  syncLayoutButtons();
  S.spacing.value = c.spacing || SPACING_DEFAULT[S.layout.value] || 100;
  S.branchSpacing.value = c.branchSpacing || BRANCH_SPACING_DEFAULT[S.layout.value] || 120;
  S.closed.checked = c.closed !== false;
  S.showCodes.checked = c.showCodes !== false;
  S.showIc.checked = c.showIc !== false;
  S.showBadge.checked = c.showBadge !== false;
  S.opaque.checked = c.opaque !== false;
  setDiagramDark(c.dark === true);
  if (c.lineInfo){
    for (const k in LINE_INFO) delete LINE_INFO[k];
    Object.assign(LINE_INFO, c.lineInfo);
  }
  renderLineInfoRows();
  const errors = setLiveFromText(c.spec || "");
  syncTextFromLive();
  syncVisibility();
  if (mode === "editor") renderEditorRows();
  render();
  fit();
  if (errors.length) showErrors(errors);
}

function setColour(hex){ S.colour.value = hex; S.hex.value = hex; }

function setDiagramDark(v){
  diagramDark = v;
  $("diagLightBtn").classList.toggle("active", !v);
  $("diagDarkBtn").classList.toggle("active", v);
}

function syncVisibility(){
  const l = S.layout.value;
  $("closedField").style.display = l === "loop"  ? "" : "none";
  $("loopRotateField").style.display = l === "loop" ? "" : "none";
  renderSpacingButtons();
  renderBranchSpacingButtons();
}

function rotateLoop(dir){
  if (mode === "text") setLiveFromText(S.spec.value);   // pick up any unsynced text edits first
  if (live.trunk.length < 2) return;
  if (dir === "cw") live.trunk.push(live.trunk.shift());
  else live.trunk.unshift(live.trunk.pop());
  syncTextFromLive();
  if (mode === "editor") renderEditorRows();
  render();
}

function reverseTrunkOrder(){
  if (mode === "text") setLiveFromText(S.spec.value);   // pick up any unsynced text edits first
  if (live.trunk.length < 2) return;
  live.trunk.reverse();
  syncTextFromLive();
  if (mode === "editor") renderEditorRows();
  render();
}

/* ------------------------------------------------------------ editor rows */
function refreshBranchFromOptions(){
  document.querySelectorAll("select.brFrom").forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = live.trunk.map(st => {
      const v = st.code || st.name || "";
      return `<option value="${esc(v)}">${esc((st.code || "?") + " — " + (st.name || "unnamed"))}</option>`;
    }).join("");
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  });
}

function makeRow(st, idx, arr){
  const row = document.createElement("div");
  row.className = "stRow";
  row.draggable = true;
  row.dataset.idx = idx;

  const handle = document.createElement("span");
  handle.className = "dragHandle"; handle.textContent = "⋮⋮";
  row.appendChild(handle);

  const codeInp = document.createElement("input");
  codeInp.className = "stCode"; codeInp.placeholder = "Code"; codeInp.value = st.code || "";
  codeInp.oninput = () => { st.code = codeInp.value.trim(); syncTextFromLive(); render(); };
  codeInp.onchange = refreshBranchFromOptions;
  row.appendChild(codeInp);

  const nameInp = document.createElement("input");
  nameInp.className = "stName"; nameInp.placeholder = "Station name"; nameInp.value = st.name || "";
  nameInp.oninput = () => { st.name = nameInp.value; syncTextFromLive(); render(); };
  nameInp.onchange = refreshBranchFromOptions;
  row.appendChild(nameInp);

  const icsInp = document.createElement("input");
  icsInp.className = "stIcs"; icsInp.placeholder = "IC codes"; icsInp.value = (st.ics || []).join(", ");
  icsInp.oninput = () => {
    st.ics = icsInp.value.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    syncTextFromLive(); render();
  };
  row.appendChild(icsInp);

  const del = document.createElement("button");
  del.type = "button"; del.className = "rowDel"; del.textContent = "✕"; del.title = "Delete station";
  del.onclick = () => { arr.splice(idx, 1); syncTextFromLive(); renderEditorRows(); render(); };
  row.appendChild(del);

  row.addEventListener("dragstart", () => { dragCtx = { arr, idx }; row.classList.add("dragging"); });
  row.addEventListener("dragend", () => row.classList.remove("dragging"));
  row.addEventListener("dragover", e => {
    if (dragCtx && dragCtx.arr === arr){ e.preventDefault(); row.classList.add("dragover"); }
  });
  row.addEventListener("dragleave", () => row.classList.remove("dragover"));
  row.addEventListener("drop", e => {
    e.preventDefault(); row.classList.remove("dragover");
    if (!dragCtx || dragCtx.arr !== arr) return;
    const from = dragCtx.idx, to = idx;
    dragCtx = null;
    if (from === to) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    syncTextFromLive(); renderEditorRows(); render();
  });

  return row;
}

function makeBranchBlock(b, bIdx){
  const wrap = document.createElement("div");
  wrap.className = "branchBlock";

  const head = document.createElement("div");
  head.className = "branchHead";

  const fromLabel = document.createElement("span");
  fromLabel.style.cssText = "font-size:11px;color:var(--muted);align-self:center";
  fromLabel.textContent = "from";
  head.appendChild(fromLabel);

  const fromSel = document.createElement("select");
  fromSel.className = "brFrom";
  fromSel.innerHTML = live.trunk.map(st => {
    const v = st.code || st.name || "";
    return `<option value="${esc(v)}">${esc((st.code || "?") + " — " + (st.name || "unnamed"))}</option>`;
  }).join("");
  fromSel.value = b.from || "";
  fromSel.onchange = () => { b.from = fromSel.value; syncTextFromLive(); render(); };
  head.appendChild(fromSel);

  const layoutVal = S.layout.value;
  {
    const dirSel = document.createElement("select");
    dirSel.className = "brDir";
    const opts = layoutVal === "vertical" ? [["right","branches right"],["left","branches left"]]
      : layoutVal === "loop" ? [["","auto (outward)"],["down","branches down"],["up","branches up"]]
      : [["down","branches down"],["up","branches up"]];
    dirSel.innerHTML = opts.map(([v,l]) => `<option value="${v}">${l}</option>`).join("");
    dirSel.value = b.dir || opts[0][0];
    dirSel.onchange = () => { b.dir = dirSel.value; syncTextFromLive(); render(); };
    head.appendChild(dirSel);
  }

  if (layoutVal !== "vertical"){
    const growSel = document.createElement("select");
    growSel.className = "brGrow";
    growSel.innerHTML = `<option value="right">grows right</option><option value="left">grows left</option>`;
    growSel.value = b.grow === "left" ? "left" : "right";
    growSel.onchange = () => { b.grow = growSel.value; syncTextFromLive(); render(); };
    head.appendChild(growSel);
  }

  const colourInp = document.createElement("input");
  colourInp.type = "color"; colourInp.title = "Branch colour override";
  colourInp.value = b.colour || S.colour.value;
  colourInp.oninput = () => { b.colour = colourInp.value; syncTextFromLive(); render(); };
  head.appendChild(colourInp);

  const delBtn = document.createElement("button");
  delBtn.type = "button"; delBtn.className = "branchDel"; delBtn.textContent = "✕ Remove branch";
  delBtn.onclick = () => { live.branches.splice(bIdx, 1); syncTextFromLive(); renderEditorRows(); render(); };
  head.appendChild(delBtn);

  wrap.appendChild(head);

  /* shuttle mode + curve style ------------------------------------------ */
  const opts = document.createElement("div");
  opts.className = "branchOpts";

  const shuttleChk = document.createElement("label");
  shuttleChk.className = "chk";
  const shuttleCb = document.createElement("input");
  shuttleCb.type = "checkbox"; shuttleCb.checked = b.mode === "shuttle";
  shuttleChk.appendChild(shuttleCb);
  shuttleChk.appendChild(document.createTextNode(" Shuttle"));
  opts.appendChild(shuttleChk);

  const labelInp = document.createElement("input");
  labelInp.type = "text"; labelInp.className = "brShuttleLabel";
  labelInp.placeholder = "Caplet (e.g. CP1)";
  labelInp.value = b.shuttleLabel || "";
  labelInp.style.display = b.mode === "shuttle" ? "" : "none";
  labelInp.oninput = () => { b.shuttleLabel = labelInp.value.trim(); syncTextFromLive(); render(); };
  opts.appendChild(labelInp);

  const curveSel = document.createElement("select");
  curveSel.className = "brCurve";
  curveSel.innerHTML = `<option value="smooth">Smooth curve</option><option value="orthogonal">Orthogonal turn</option>`;
  curveSel.value = b.curve || "smooth";
  curveSel.disabled = b.mode === "shuttle";
  curveSel.onchange = () => { b.curve = curveSel.value; syncTextFromLive(); render(); };
  opts.appendChild(curveSel);

  shuttleCb.onchange = () => {
    b.mode = shuttleCb.checked ? "shuttle" : "split";
    if (b.mode === "shuttle") b.curve = "orthogonal";
    labelInp.style.display = shuttleCb.checked ? "" : "none";
    curveSel.disabled = shuttleCb.checked;
    curveSel.value = b.curve || "smooth";
    syncTextFromLive(); render();
  };
  wrap.appendChild(opts);

  const rows = document.createElement("div");
  rows.className = "rowList branchRows";
  b.stations.forEach((st, i) => rows.appendChild(makeRow(st, i, b.stations)));
  wrap.appendChild(rows);

  const addBtn = document.createElement("button");
  addBtn.type = "button"; addBtn.className = "addBtn"; addBtn.textContent = "+ Add station to branch";
  addBtn.onclick = () => { b.stations.push({ code:"", name:"", ics:[] }); syncTextFromLive(); renderEditorRows(); render(); };
  wrap.appendChild(addBtn);

  return wrap;
}

function renderEditorRows(){
  const trunkRows = $("trunkRows");
  trunkRows.innerHTML = "";
  live.trunk.forEach((st, i) => trunkRows.appendChild(makeRow(st, i, live.trunk)));

  const bc = $("branchesContainer");
  bc.innerHTML = "";
  live.branches.forEach((b, i) => bc.appendChild(makeBranchBlock(b, i)));
}

function setMode(next){
  if (next === mode) return;
  if (mode === "editor" && next === "text"){
    syncTextFromLive();
  } else if (mode === "text" && next === "editor"){
    const errors = setLiveFromText(S.spec.value);
    if (errors.length) showErrors(errors);
  }
  mode = next;
  $("modeEditorBtn").classList.toggle("active", mode === "editor");
  $("modeTextBtn").classList.toggle("active", mode === "text");
  $("editorView").style.display = mode === "editor" ? "" : "none";
  $("textView").style.display = mode === "text" ? "" : "none";
  if (mode === "editor") renderEditorRows();
  render();
}

/* ------------------------------------------------------------------- render */
function render(){
  const cfg = readForm();
  const errs = [...cfg.errors];

  if (!cfg.trunk.length){
    $("stage").innerHTML = "";
    showErrors(errs.length ? errs : ["Add at least one station to draw a diagram."]);
    $("stationCount").textContent = "";
    current = null;
    return;
  }

  let out;
  try {
    out = buildDiagram(cfg);
  } catch (e){
    showErrors([...errs, "Render failed: " + e.message]);
    return;
  }
  errs.push(...out.warnings);

  const stage = $("stage");
  stage.innerHTML = "";
  stage.appendChild(out.svg);
  current = out;
  applyZoom();

  const nBranch = cfg.branches.reduce((s, b) => s + b.stations.length, 0);
  $("stationCount").textContent =
    `${cfg.trunk.length} station${cfg.trunk.length === 1 ? "" : "s"}` +
    (nBranch ? ` + ${nBranch} on ${cfg.branches.length} branch${cfg.branches.length === 1 ? "" : "es"}` : "");
  showErrors(errs);
  save();
  pushHistory();
}

function showErrors(list){
  const box = $("errors");
  if (!list.length){ box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "block";
  box.innerHTML = list.length === 1 ? list[0]
    : "<ul>" + list.map(e => `<li>${e}</li>`).join("") + "</ul>";
}

/* --------------------------------------------------------------------- zoom */
function applyZoom(){
  if (!current) return;
  current.svg.setAttribute("width",  Math.ceil(current.width  * zoom));
  current.svg.setAttribute("height", Math.ceil(current.height * zoom));
  $("zoomLabel").textContent = Math.round(zoom * 100) + "%";
}
function setZoom(z){ zoom = Math.min(4, Math.max(.08, z)); applyZoom(); }
function fit(){
  if (!current) return;
  const m = $("main");
  const avail = m.clientWidth - 60, availH = m.clientHeight - 60;
  setZoom(Math.min(1, avail / current.width, availH / current.height));
}
function fitWidth(){
  if (!current) return;
  const avail = $("main").clientWidth - 60;
  setZoom(Math.min(1, avail / current.width));
}
function fitHeight(){
  if (!current) return;
  const availH = $("main").clientHeight - 60;
  setZoom(Math.min(1, availH / current.height));
}

/* ------------------------------------------------------------------ exports */
/* The page's @font-face points at a local fonts/ file via a <link>
   stylesheet — that reference means nothing once the SVG is exported
   standalone, so the font silently falls back everywhere else it's
   opened. Embed the actual font bytes as a data URI @font-face inside
   the exported SVG when the file is present; fails silently (font just
   isn't embedded) if it isn't. */
let fontDataUriCache = null;
async function fontDataUri(){
  if (fontDataUriCache !== null) return fontDataUriCache;
  for (const [file, fmt] of [["fonts/LTAIdentity-Medium.woff2", "woff2"], ["fonts/LTAIdentity-Medium.woff", "woff"]]){
    try {
      const res = await fetch(file);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      let binary = "";
      new Uint8Array(buf).forEach(b => { binary += String.fromCharCode(b); });
      const b64 = btoa(binary);
      fontDataUriCache = `@font-face{font-family:"LTA Identity";font-weight:400 700;` +
        `src:url(data:font/${fmt};base64,${b64}) format("${fmt}");}`;
      return fontDataUriCache;
    } catch (e){ /* try next format */ }
  }
  fontDataUriCache = "";
  return fontDataUriCache;
}

async function serialize(){
  if (!current) return null;
  const clone = current.svg.cloneNode(true);
  clone.setAttribute("width",  Math.ceil(current.width));
  clone.setAttribute("height", Math.ceil(current.height));
  clone.setAttribute("xmlns", SVGNS);
  const fontCss = await fontDataUri();
  if (fontCss){
    const style = document.createElementNS(SVGNS, "style");
    style.textContent = fontCss;
    clone.insertBefore(style, clone.firstChild);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
         new XMLSerializer().serializeToString(clone);
}
function slug(){
  const c = readForm();
  return (c.name || c.code || "line-diagram").toLowerCase().replace(/[^a-z0-9]+/g, "-")
         .replace(/^-|-$/g, "") || "line-diagram";
}
function download(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

$("dlSvg").onclick = async () => {
  const s = await serialize();
  if (s) download(new Blob([s], { type:"image/svg+xml" }), slug() + ".svg");
};

$("dlPng").onclick = async () => {
  const s = await serialize();
  if (!s) return;
  const scale = 2;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width  = Math.ceil(current.width  * scale);
    cv.height = Math.ceil(current.height * scale);
    const ctx = cv.getContext("2d");
    if (readForm().opaque){ ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    cv.toBlob(b => b && download(b, slug() + ".png"), "image/png");
  };
  img.onerror = () => showErrors(["Could not rasterise to PNG — the SVG download still works."]);
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
};

$("dlJson").onclick = () => {
  const c = readForm();
  const data = {
    name:c.name, code:c.code, colour:c.colour, layout:c.layout,
    spacing:c.spacing, closed:c.closed, showCodes:c.showCodes, showIc:c.showIc,
    showBadge:c.showBadge, opaque:c.opaque, dark:c.dark, spec:S.spec.value,
    lineInfo:LINE_INFO
  };
  download(new Blob([JSON.stringify(data, null, 2)], { type:"application/json" }),
           slug() + ".json");
};

$("upJson").onclick = () => $("fileInput").click();
$("fileInput").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try { applyConfig(JSON.parse(r.result)); }
    catch (err){ showErrors(["That file isn't valid diagram JSON: " + err.message]); }
  };
  r.readAsText(f);
  e.target.value = "";
};

/* --------------------------------------------------------------- persistence */
const KEY = "lineDiagramGenerator.v1";
function snapshotConfig(){
  return {
    name:S.name.value, code:S.code.value, colour:S.colour.value, layout:S.layout.value,
    spacing:S.spacing.value, branchSpacing:S.branchSpacing.value, closed:S.closed.checked,
    showCodes:S.showCodes.checked, showIc:S.showIc.checked,
    showBadge:S.showBadge.checked, opaque:S.opaque.checked, dark:diagramDark, spec:S.spec.value,
    lineInfo:LINE_INFO
  };
}
function save(){
  try { localStorage.setItem(KEY, JSON.stringify(snapshotConfig())); }
  catch (e){ /* storage disabled — no problem */ }
}

/* -------------------------------------------------------------- undo/redo */
/* History is a stack of full-config snapshots (same shape as `save()`
   persists), captured on a short debounce after render() so a burst of
   edits (typing, dragging) collapses into one undo step instead of one
   per keystroke. isRestoring guards against an undo/redo's own render()
   call feeding straight back into history. */
let undoStack = [], redoStack = [];
let lastSnapshot = null;
let isRestoring = false;
let historyTimer = null;
const HISTORY_DEBOUNCE = 500;
const HISTORY_LIMIT = 200;

function updateUndoRedoButtons(){
  $("undoBtn").disabled = undoStack.length === 0;
  $("redoBtn").disabled = redoStack.length === 0;
}
function pushHistory(){
  clearTimeout(historyTimer);
  if (isRestoring) return;
  historyTimer = setTimeout(() => {
    const snap = JSON.stringify(snapshotConfig());
    if (lastSnapshot === null){ lastSnapshot = snap; return; }   // first call just sets the baseline
    if (snap === lastSnapshot) return;
    undoStack.push(lastSnapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    lastSnapshot = snap;
    redoStack = [];
    updateUndoRedoButtons();
  }, HISTORY_DEBOUNCE);
}
function restoreSnapshot(json){
  isRestoring = true;
  applyConfig(JSON.parse(json));
  isRestoring = false;
  updateUndoRedoButtons();
}
function undo(){
  if (!undoStack.length) return;
  clearTimeout(historyTimer);   // drop any not-yet-committed pending edit
  redoStack.push(lastSnapshot);
  lastSnapshot = undoStack.pop();
  restoreSnapshot(lastSnapshot);
}
function redo(){
  if (!redoStack.length) return;
  clearTimeout(historyTimer);
  undoStack.push(lastSnapshot);
  lastSnapshot = redoStack.pop();
  restoreSnapshot(lastSnapshot);
}
$("undoBtn").onclick = undo;
$("redoBtn").onclick = redo;
document.addEventListener("keydown", e => {
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;   // let the field's own undo happen
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey){ e.preventDefault(); undo(); }
  else if (k === "y" || (k === "z" && e.shiftKey)){ e.preventDefault(); redo(); }
});

/* ------------------------------------------------------------------- wiring */
SWATCHES.forEach(c => {
  const b = document.createElement("button");
  b.className = "sw"; b.style.background = c; b.title = c;
  b.onclick = () => { setColour(c); render(); };
  $("swatches").appendChild(b);
});

["input", "change"].forEach(ev => {
  [S.name, S.code, S.spec, S.showCodes, S.showIc, S.showBadge, S.opaque, S.closed]
    .forEach(n => n.addEventListener(ev, render));
});
S.colour.addEventListener("input", () => { S.hex.value = S.colour.value; render(); });
S.hex.addEventListener("input", () => {
  const v = S.hex.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)){ S.colour.value = v; render(); }
});
function syncLayoutButtons(){
  document.querySelectorAll("#layoutRow .spacingBtn").forEach(b => {
    b.classList.toggle("active", b.dataset.value === S.layout.value);
  });
}
function setLayout(v){
  S.layout.value = v;
  syncLayoutButtons();
  S.spacing.value = SPACING_DEFAULT[S.layout.value] || 100;
  S.branchSpacing.value = BRANCH_SPACING_DEFAULT[S.layout.value] || 120;
  syncVisibility();
  if (mode === "editor") renderEditorRows();
  render(); fit();
}
document.querySelectorAll("#layoutRow .spacingBtn").forEach(b => {
  b.onclick = () => setLayout(b.dataset.value);
});

$("addStationBtn").onclick = () => {
  live.trunk.push({ code:"", name:"", ics:[] });
  syncTextFromLive(); renderEditorRows(); render();
};
$("addBranchBtn").onclick = () => {
  const last = live.trunk[live.trunk.length - 1];
  live.branches.push({
    from: last ? (last.code || last.name || "") : "",
    dir: S.layout.value === "vertical" ? "right" : "down",
    colour: null, stations: [{ code:"", name:"", ics:[] }]
  });
  syncTextFromLive(); renderEditorRows(); render();
};
$("addLineInfoBtn").onclick = () => {
  let key = "XX", n = 1;
  while (LINE_INFO[key]) key = "XX" + (n++);
  LINE_INFO[key] = { name:"New Line", colour:"#8a9099", acr:key };
  renderLineInfoRows();
  render();
};
$("modeEditorBtn").onclick = () => setMode("editor");
$("modeTextBtn").onclick = () => setMode("text");
$("loopRotateCw").onclick = () => rotateLoop("cw");
$("loopRotateCcw").onclick = () => rotateLoop("ccw");
$("reverseOrderBtn").onclick = reverseTrunkOrder;

PRESET_GROUPS.forEach(group => {
  const label = document.createElement("div");
  label.className = "presetGroupLabel";
  label.textContent = group.name;
  $("presetRow").appendChild(label);

  const row = document.createElement("div");
  row.className = "presetGroupRow";
  group.items.forEach(p => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "presetBtn"; b.title = p.label;
    const cap = document.createElement("span");
    cap.className = "presetCap"; cap.style.background = p.colour; cap.textContent = p.acr;
    b.appendChild(cap);
    b.appendChild(document.createTextNode(p.label));
    b.onclick = () => { const ex = EXAMPLES[p.key]; if (ex) applyConfig(ex); };
    row.appendChild(b);
  });
  $("presetRow").appendChild(row);
});

$("zoomIn").onclick  = () => setZoom(zoom * 1.25);
$("zoomOut").onclick = () => setZoom(zoom / 1.25);
$("fitWidth").onclick = fitWidth;
$("fitHeight").onclick = fitHeight;
$("main").addEventListener("wheel", e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1/1.1));
}, { passive:false });

/* --------------------------------------------------------------- export menu */
$("exportMenuBtn").onclick = e => {
  e.stopPropagation();
  $("exportMenu").classList.toggle("open");
};
$("exportMenuPanel").addEventListener("click", e => {
  if (e.target.tagName === "BUTTON") $("exportMenu").classList.remove("open");
});
document.addEventListener("click", e => {
  if (!$("exportMenu").contains(e.target)) $("exportMenu").classList.remove("open");
});

/* --------------------------------------------------------------------- theme */
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  const btn = $("themeToggle");
  btn.textContent = t === "dark" ? "☀" : "☾";
  btn.title = t === "dark" ? "Switch to light theme" : "Switch to dark theme";
  try { localStorage.setItem("theme", t); } catch (e){}
}
$("themeToggle").onclick = () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  render();
};
$("diagLightBtn").onclick = () => { setDiagramDark(false); render(); };
$("diagDarkBtn").onclick = () => { setDiagramDark(true); render(); };
let savedTheme = null;
try { savedTheme = localStorage.getItem("theme"); } catch (e){}
applyTheme(savedTheme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

/* ------------------------------------------------------------------- startup */
let boot = null;
try { boot = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e){}
applyConfig(boot || EXAMPLES.cc);

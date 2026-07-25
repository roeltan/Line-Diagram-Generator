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
  NS:{ name:"North South Line", colour:"#d42e12", acr:"NSL" },
  EW:{ name:"East West Line", colour:"#009645", acr:"EWL" },
  CG:{ name:"East West Line", colour:"#009645", acr:"EWL" },
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
  BP:{ name:"Bukit Panjang LRT", colour:"#718573", acr:"BPLRT" },
  STC:{ name:"Sengkang LRT", colour:"#718573", acr:"SKLRT" }, SW:{ name:"Sengkang LRT", colour:"#718573", acr:"SKLRT" }, SE:{ name:"Sengkang LRT", colour:"#718573", acr:"SKLRT" },
  PTC:{ name:"Punggol LRT", colour:"#718573", acr:"PGLRT" }, PW:{ name:"Punggol LRT", colour:"#718573", acr:"PGLRT" }, PE:{ name:"Punggol LRT", colour:"#718573", acr:"PGLRT" }
};
const SWATCHES = ["#d42e12","#009645","#9900aa","#fa9e0d","#005ec4","#9d5b25",
                 "#0099aa","#97c616","#718573","#e8467c","#00a1de","#1f2937"];

function colourForCode(code, fallback){
  const m = /^([A-Z]+)/.exec((code||"").toUpperCase());
  const info = m && LINE_INFO[m[1]];
  return (info && info.colour) || fallback;
}

/* ------------------------------------------------------------------- style */
const STYLE = {
  lineWidth:11,
  icStroke:"#33383d",
  nameSize:14, nameWeight:600, nameFill:"#1b1f24",
  codeSize:10.5, codeH:18, codeGap:14,
  capletOutline:"#ffffff", capletOutlineW:2
};
const FONT = '"LTA Identity", -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif';

/* Rough text width; good enough for bounding boxes and label offsets. */
const measure = (t, size) => (t ? t.length * size * 0.565 : 0);
/* All codes up to 4 chars share one uniform caplet width (as if every code
   were 4 chars) so e.g. EW7 and EW23 render the same size; only longer
   strings (used for legend acronyms like BPLRT) grow past that. */
const CODE_BOX_W_MIN = 4 * 7.6 + 14;
const codeBoxW = t => Math.max(CODE_BOX_W_MIN, t.length * 7.6 + 14);

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
      const m = /^\[\s*branch\s+from\s+([^\s,;\]]+)\s*(up|down|left|right)?\s*(?::\s*(.*?))?\s*\]$/i.exec(s);
      if (!m){
        errors.push(`Line ${i+1}: expected <code>[branch from CODE up: Name]</code>`);
        return;
      }
      let name = (m[3] || "").trim(), colour = null;
      const cm = /(#[0-9a-fA-F]{3,8})\s*$/.exec(name);
      if (cm){ colour = cm[1]; name = name.slice(0, cm.index).trim(); }
      const b = { from:m[1], dir:(m[2]||"").toLowerCase(), name, colour, stations:[], line:i+1 };
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

/* -------------------------------------------------------- stadium (loop) */
/* Arc-length parameterised stadium/pill outline (two straight edges joined
   by semicircle end-caps — built as a degenerate rounded rect with
   r = height/2, so the "side" edges collapse to zero length). Gives point
   + outward normal at any distance t around the full perimeter (`at`), or
   restricted to just the straight top/bottom edges (`atStraight`) so
   stations never land on the curved caps. */
function racetrack(x0, y0, x1, y1, r){
  const segs = [];
  const lineSegs = [];
  let tCursor = 0;
  const line = (ax, ay, bx, by, nx, ny) => {
    const len = Math.hypot(bx-ax, by-ay);
    const seg = { t:"L", ax, ay, bx, by, nx, ny, len, tStart:tCursor };
    segs.push(seg); lineSegs.push(seg);
    tCursor += len;
  };
  const arc = (cx, cy, a0, a1) => {
    const len = r * Math.abs(a1 - a0);
    segs.push({ t:"A", cx, cy, r, a0, a1, len });
    tCursor += len;
  };
  const D = Math.PI / 180;

  line(x0+r, y0, x1-r, y0,  0, -1);
  arc (x1-r, y0+r, -90*D, 0);
  line(x1, y0+r, x1, y1-r,  1,  0);
  arc (x1-r, y1-r, 0, 90*D);
  line(x1-r, y1, x0+r, y1,  0,  1);
  arc (x0+r, y1-r, 90*D, 180*D);
  line(x0, y1-r, x0, y0+r, -1,  0);
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
  const svg = el("svg", { xmlns:SVGNS, version:"1.1" });
  const gLines   = el("g", { fill:"none", "stroke-linecap":"round", "stroke-linejoin":"round" }, svg);
  const gLabels  = el("g", { "font-family":FONT }, svg);
  const gMarkers = el("g", null, svg);
  const bb = makeBBox();
  const F2 = v => v.toFixed(2);

  /* ---- resolve nodes: trunk positions per layout, then branches ---- */
  const nodes = [];   // {code,name,ics,x,y,kind,label}
  const sp = cfg.spacing;

  /* label spec helpers -------------------------------------------------- */
  const DIAG  = { nameRot:-45, nameAnchor:"start", nameDX:11, nameDY:-13, codeDir:[0,1] };
  const RIGHT = { nameRot:0,   nameAnchor:"start",  codeDir:[1,0],  inline:true };
  const LEFT  = { nameRot:0,   nameAnchor:"end",    codeDir:[-1,0], inline:true };
  const UP    = { nameRot:0,   nameAnchor:"middle", codeDir:[0,-1], inline:true };
  const DOWN  = { nameRot:0,   nameAnchor:"middle", codeDir:[0,1],  inline:true };
  const VLIST = { nameRot:0,   nameAnchor:"start", nameDX:16, nameDY:5, codeDir:[-1,0] };

  let trunkPath = "";            // path 'd' for the trunk
  let loop = null;               // stadium geometry, when layout === 'loop'

  if (cfg.layout === "loop"){
    const n = Math.max(trunk.length, 2);
    const H = Math.max(sp * 2, 200);
    const W = (n * sp) / 2 + H;
    loop = racetrack(0, 0, W, H, H / 2);
    const step = loop.straightTotal / n;
    /* No station sits on the semicircular end-caps, so nothing else would
       ever feed their outer extent into the bounding box — without this
       they get clipped out of the viewBox. */
    bb.add(0, 0); bb.add(W, H);

    trunk.forEach((st, i) => {
      const p = loop.atStraight(i * step);
      nodes.push({ ...st, x:p.x, y:p.y, nx:p.nx, ny:p.ny, colour,
                   kind: cfg.closed ? "" : (i === 0 || i === trunk.length-1 ? "term" : ""),
                   label: p.ny < 0 ? UP : DOWN });
    });
    trunkPath = cfg.closed
      ? loop.path(0, loop.total)
      : loop.path(0, loop.atStraight((trunk.length - 1) * step).t);

  } else if (cfg.layout === "vertical"){
    trunk.forEach((st, i) => {
      nodes.push({ ...st, x:0, y:i * sp, colour, label:VLIST,
                   kind: (i === 0 || i === trunk.length-1) ? "term" : "" });
    });
    trunkPath = `M 0 0 L 0 ${((trunk.length-1)*sp).toFixed(2)}`;

  } else { /* horizontal */
    trunk.forEach((st, i) => {
      nodes.push({ ...st, x:i * sp, y:0, colour, label:DIAG,
                   kind: (i === 0 || i === trunk.length-1) ? "term" : "" });
    });
    trunkPath = `M 0 0 L ${((trunk.length-1)*sp).toFixed(2)} 0`;
  }

  const trunkCount = nodes.length;
  el("path", { d:trunkPath, stroke:colour, "stroke-width":STYLE.lineWidth }, gLines);

  /* ---- branches: smooth curve out of the trunk, then straight ---- */
  const warnings = [];
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
    const gap = Math.max(sp * 1.25, 120);
    const run = Math.max(sp * 0.9, 70);   // length of the smooth curve near the junction
    const F = v => v.toFixed(2);

    if (cfg.layout === "loop"){
      /* radial spur pointing away from the loop; own label flips inward */
      jn.label = jn.label === UP ? DOWN : UP;
      const side = jn.ny < 0 ? UP : DOWN;
      b.stations.forEach((st, i) => {
        const d = gap + i * sp;
        nodes.push({ ...st, x:jn.x + jn.nx * d, y:jn.y + jn.ny * d, colour:bc, label:side,
                     kind: i === b.stations.length-1 ? "term" : "", branch:b });
      });
      const lastD = gap + (b.stations.length-1) * sp;
      el("path", { d:`M ${F(jn.x)} ${F(jn.y)} L ${F(jn.x + jn.nx*lastD)} ${F(jn.y + jn.ny*lastD)}`,
                   stroke:bc, "stroke-width":STYLE.lineWidth }, gLines);

    } else if (cfg.layout === "vertical"){
      jn.label = (b.dir === "left") ? RIGHT : LEFT;
      const sgn = b.dir === "left" ? -1 : 1;
      const bx = jn.x + sgn * gap;
      const y1 = jn.y + run;
      b.stations.forEach((st, i) => {
        nodes.push({ ...st, x:bx, y:y1 + i * sp, colour:bc,
                     label: sgn < 0 ? LEFT : VLIST,
                     kind: i === b.stations.length-1 ? "term" : "", branch:b });
      });
      const lastY = y1 + (b.stations.length-1)*sp;
      const c1y = jn.y + run*0.6, c2y = y1 - run*0.4;
      el("path", { d:`M ${F(jn.x)} ${F(jn.y)} C ${F(jn.x)} ${F(c1y)}, ${F(bx)} ${F(c2y)}, ${F(bx)} ${F(y1)} L ${F(bx)} ${F(lastY)}`,
                   stroke:bc, "stroke-width":STYLE.lineWidth }, gLines);

    } else { /* horizontal */
      jn.label = (b.dir === "up") ? DOWN : UP;
      const sgn = b.dir === "up" ? -1 : 1;
      const by = jn.y + sgn * gap;
      const x1 = jn.x + run;
      b.stations.forEach((st, i) => {
        nodes.push({ ...st, x:x1 + i * sp, y:by, colour:bc, label:DIAG,
                     kind: i === b.stations.length-1 ? "term" : "", branch:b });
      });
      const lastX = x1 + (b.stations.length-1)*sp;
      const c1x = jn.x + run*0.6, c2x = x1 - run*0.4;
      el("path", { d:`M ${F(jn.x)} ${F(jn.y)} C ${F(c1x)} ${F(jn.y)}, ${F(c2x)} ${F(by)}, ${F(x1)} ${F(by)} L ${F(lastX)} ${F(by)}`,
                   stroke:bc, "stroke-width":STYLE.lineWidth }, gLines);
    }
  });

  /* ---- labels + markers: the station-code caplet doubles as the marker ---- */
  nodes.forEach(n => {
    const L = n.label;
    const codes = [];
    if (cfg.showCodes && n.code) codes.push({ t:n.code, c:n.colour });
    if (cfg.showIc) n.ics.forEach(c => codes.push({ t:c, c:colourForCode(c, n.colour) }));

    const dir = L.codeDir;
    const horiz = Math.abs(dir[0]) > Math.abs(dir[1]);
    const h = STYLE.codeH;
    let codesExtent = 0;

    if (codes.length){
      /* Each code gets its own separate pill-shaped caplet (own fill, own
         white outline) — the station's own line (codes[0]) sits centred
         straddling the line itself; any interchange codes after it stack
         outward, each one abutting the previous with no gap. */
      let edge = horiz ? n.x : n.y;   // running outward edge, starts at the line
      codes.forEach((cd, idx) => {
        const w = codeBoxW(cd.t);
        let cx, cy;
        if (horiz){
          cx = idx === 0 ? n.x : edge + dir[0] * (w / 2);
          edge = idx === 0 ? n.x + dir[0] * (w / 2) : edge + dir[0] * w;
          cy = n.y;
        } else {
          cy = idx === 0 ? n.y : edge + dir[1] * (h / 2);
          edge = idx === 0 ? n.y + dir[1] * (h / 2) : edge + dir[1] * h;
          cx = n.x;
        }
        el("rect", { x:F2(cx - w/2), y:F2(cy - h/2), width:F2(w), height:F2(h), rx:F2(h/2),
                     fill:cd.c, stroke:STYLE.capletOutline, "stroke-width":STYLE.capletOutlineW }, gLabels);
        const tx = el("text", { x:F2(cx), y:F2(cy + 3.9), "text-anchor":"middle",
                                "font-size":STYLE.codeSize, "font-weight":700, fill:"#fff",
                                "letter-spacing":".3" }, gLabels);
        tx.textContent = cd.t;
        bb.rect(cx - w/2 - 1, cy - h/2 - 1, w + 2, h + 2);
      });
      codesExtent = Math.abs(edge - (horiz ? n.x : n.y));
    }

    /* station name */
    if (n.name){
      let nx, ny;
      if (L.inline){
        const d = (codesExtent || STYLE.codeGap) + 8;
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
      const t = el("text", {
        x:F2(nx), y:F2(ny),
        "text-anchor":L.nameAnchor,
        "font-size":STYLE.nameSize,
        "font-weight":STYLE.nameWeight,
        fill:STYLE.nameFill,
        transform: L.nameRot ? `rotate(${L.nameRot} ${F2(nx)} ${F2(ny)})` : null
      }, gLabels);
      t.textContent = n.name;
      bb.text(nx, ny, n.name, STYLE.nameSize, L.nameRot, L.nameAnchor);
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

  /* ---- legend: every line referenced on this diagram (own line + any
     interchange codes seen), so a reader can identify what each colour means */
  const legendSeen = new Set(), legendItems = [];
  const addLegend = (code, fallbackColour) => {
    const m = /^([A-Za-z]+)/.exec(code || "");
    const prefix = m ? m[1].toUpperCase() : (code || "").toUpperCase();
    const info = LINE_INFO[prefix];
    const name = (info && info.name) || code || "Line";
    if (legendSeen.has(name)) return;
    legendSeen.add(name);
    legendItems.push({ name, colour: (info && info.colour) || fallbackColour, acr: (info && info.acr) || prefix });
  };
  if (cfg.code || cfg.name) addLegend(cfg.code || cfg.name, colour);
  if (cfg.showIc) nodes.forEach(n => n.ics.forEach(c => addLegend(c, colour)));

  if (legendItems.length > 1 || (legendItems.length === 1 && cfg.code)){
    const g = el("g", { "font-family":FONT }, svg);
    const lh = 17;
    let lx = bb.x0, ly = bb.y1 + 36;
    const rowMaxX = bb.x0 + Math.max(bb.x1 - bb.x0, 480);
    legendItems.forEach(it => {
      const capW = codeBoxW(it.acr);
      const w = capW + 8 + measure(it.name, 11.5) + 18;
      if (lx + w > rowMaxX && lx > bb.x0){ lx = bb.x0; ly += 26; }
      el("rect", { x:F2(lx), y:F2(ly - lh/2), width:F2(capW), height:F2(lh), rx:F2(lh/2), fill:it.colour }, g);
      const capText = el("text", { x:F2(lx + capW/2), y:F2(ly + 3.6), "text-anchor":"middle",
                                   "font-size":9.5, "font-weight":700, fill:"#fff", "letter-spacing":".3" }, g);
      capText.textContent = it.acr;
      const t = el("text", { x:F2(lx + capW + 8), y:F2(ly + 4.2), "font-size":11.5, "font-weight":600,
                             fill:STYLE.nameFill }, g);
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
      el("rect", { x:bx, y:by, width:w, height:36, rx:7, fill:colour }, g);
      const t = el("text", { x:bx + w/2, y:by + 24.5, "text-anchor":"middle",
                             "font-size":17, "font-weight":800, fill:"#fff",
                             "letter-spacing":".5" }, g);
      t.textContent = cfg.code;
      bb.rect(bx, by, w, 36);
      x = bx + w + 13;
    }
    if (cfg.name){
      const t = el("text", { x:x, y:by + 25.5, "font-size":23, "font-weight":750,
                             fill:STYLE.nameFill, "letter-spacing":"-.01em" }, g);
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
    const bg = el("rect", { x:x0, y:y0, width:w, height:h, fill:"#ffffff" });
    svg.insertBefore(bg, svg.firstChild);
  }
  return { svg, width:w, height:h, warnings };
}

/* ================================================================== the app */
const $ = id => document.getElementById(id);
const S = {
  spec:$("spec"), name:$("lineName"), code:$("lineCode"), colour:$("lineColor"),
  hex:$("colorHex"), layout:$("layout"), spacing:$("spacing"),
  closed:$("closed"), showCodes:$("showCodes"), showIc:$("showIc"),
  showBadge:$("showBadge"), opaque:$("opaque")
};
let zoom = 1, current = null;

const SPACING_DEFAULT = { horizontal:100, vertical:56, loop:104 };

/* Preset picker metadata — drives the little coloured line-acronym caplets
   shown under the Stations header. `key` looks up EXAMPLES. */
const PRESET_META = [
  { key:"ns",  acr:"NSL", label:"North South Line",  colour:"#d42e12" },
  { key:"ew",  acr:"EWL", label:"East West Line",     colour:"#009645" },
  { key:"cc",  acr:"CCL", label:"Circle Line",        colour:"#fa9e0d" },
  { key:"ne",  acr:"NEL", label:"North East Line",    colour:"#9900aa" },
  { key:"jrl", acr:"JRL", label:"Jurong Region Line", colour:"#0099aa" },
  { key:"crl", acr:"CRL", label:"Cross Island Line",  colour:"#97c616" },
  { key:"blank", acr:"—", label:"Blank template",     colour:"#8a9099" }
];

const EXAMPLES = {
  ns:{
    name:"North South Line", code:"NS", colour:"#d42e12", layout:"horizontal", spacing:100,
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
NS21 Newton             > DT11
NS22 Orchard            > TE14
NS23 Somerset
NS24 Dhoby Ghaut        > NE6, CC1
NS25 City Hall          > EW13
NS26 Raffles Place      > EW14
NS27 Marina Bay         > CC33, TE20
NS28 Marina South Pier`
  },
  ew:{
    name:"East West Line", code:"EW", colour:"#009645", layout:"horizontal", spacing:100,
    spec:`EW1  Pasir Ris
EW2  Tampines           > DT32
EW3  Simei
EW4  Tanah Merah
EW5  Bedok
EW6  Kembangan
EW7  Eunos
EW8  Paya Lebar         > CC9
EW9  Aljunied
EW10 Kallang
EW11 Lavender
EW12 Bugis              > DT14
EW13 City Hall          > NS25
EW14 Raffles Place      > NS26
EW15 Tanjong Pagar
EW16 Outram Park        > NE3, TE17
EW17 Tiong Bahru
EW18 Redhill
EW19 Queenstown
EW20 Commonwealth
EW21 Buona Vista        > CC22
EW22 Dover
EW23 Clementi
EW24 Jurong East        > NS1
EW25 Chinese Garden
EW26 Lakeside
EW27 Boon Lay
EW28 Pioneer
EW29 Joo Koon
EW30 Gul Circle
EW31 Tuas Crescent
EW32 Tuas West Road
EW33 Tuas Link

[branch from EW4 down]
CG1  Expo               > DT35
CG2  Changi Airport`
  },
  cc:{
    /* Circle Line Stage 6 (Keppel / Cantonment / Prince Edward Road) opened
       12 Jul 2026, closing the loop and renumbering the old Marina Bay spur
       (CE1/CE2) into CC33/CC34. The loop itself now runs CC4→CC34→back to
       CC4; Dhoby Ghaut/Bras Basah/Esplanade (CC1-CC3) are a short spur off
       Promenade (CC4) — a real example of a loop layout with a branch. */
    name:"Circle Line", code:"CC", colour:"#fa9e0d", layout:"loop", spacing:104, closed:true,
    spec:`CC4  Promenade          > DT15
CC5  Nicoll Highway
CC6  Stadium
CC7  Mountbatten
CC8  Dakota
CC9  Paya Lebar         > EW8
CC10 MacPherson         > DT26
CC11 Tai Seng
CC12 Bartley
CC13 Serangoon          > NE12
CC14 Lorong Chuan
CC15 Bishan             > NS17
CC16 Marymount
CC17 Caldecott          > TE9
CC19 Botanic Gardens    > DT9
CC20 Farrer Road
CC21 Holland Village
CC22 Buona Vista        > EW21
CC23 one-north
CC24 Kent Ridge
CC25 Haw Par Villa
CC26 Pasir Panjang
CC27 Labrador Park
CC28 Telok Blangah
CC29 HarbourFront       > NE1, EW17
CC30 Keppel
CC31 Cantonment
CC32 Prince Edward Road
CC33 Marina Bay         > NS27, TE20
CC34 Bayfront           > DT16

[branch from CC4]
CC3  Esplanade
CC2  Bras Basah
CC1  Dhoby Ghaut        > NS24, NE6`
  },
  ne:{
    name:"North East Line", code:"NE", colour:"#9900aa", layout:"horizontal", spacing:100,
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
  jrl:{
    /* Jurong Region Line — under construction, phased opening from mid-2028.
       JS is the trunk; JW (NTU spur) branches off Bahar Junction (JS7),
       while JE (Tengah/Jurong East spur) branches off Tengah (JS3) —
       a real two-branch example, each off a different junction. */
    name:"Jurong Region Line", code:"JRL", colour:"#0099aa", layout:"horizontal", spacing:100,
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

[branch from JS7 down]
JW1  Gek Poh
JW2  Tawas
JW3  Nanyang Gateway
JW4  Nanyang Crescent
JW5  Peng Kang Hill

[branch from JS3 up]
JE1  Tengah Plantation
JE2  Tengah Park
JE3  Bukit Batok West
JE4  Toh Guan
JE5  Jurong East         > NS1, EW24
JE6  Jurong Town Hall
JE7  Pandan Reservoir`
  },
  crl:{
    /* Cross Island Line — under construction, Phase 1 targeted 2030. Shown
       vertically with the Punggol Extension (CP) branching off Pasir Ris. */
    name:"Cross Island Line", code:"CRL", colour:"#97c616", layout:"horizontal", spacing:100,
    spec:`# Under construction — Phase 1 target 2030, Punggol Extension 2032
CR2  Aviation Park
CR3  Loyang
CR4  Pasir Ris East
CR5  Pasir Ris           > EW1
CR6  Tampines North
CR7  Defu
CR8  Hougang             > NE14
CR9  Serangoon North
CR10 Tavistock
CR11 Ang Mo Kio          > NS16
CR12 Teck Ghee
CR13 Bright Hill         > TE

[branch from CR5 down]
CP2  Elias
CP3  Riviera             > PE4
CP4  Punggol             > NE17, PTC`
  },
  blank:{
    name:"My Line", code:"ML", colour:"#005ec4", layout:"horizontal", spacing:100,
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
    closed:S.closed.checked, showCodes:S.showCodes.checked, showIc:S.showIc.checked,
    showBadge:S.showBadge.checked, opaque:S.opaque.checked,
    trunk, branches, errors
  };
}

function applyConfig(c){
  S.name.value = c.name || "";
  S.code.value = c.code || "";
  setColour(c.colour || "#005ec4");
  S.layout.value = c.layout || "horizontal";
  S.spacing.value = c.spacing || SPACING_DEFAULT[S.layout.value] || 100;
  S.closed.checked = c.closed !== false;
  S.showCodes.checked = c.showCodes !== false;
  S.showIc.checked = c.showIc !== false;
  S.showBadge.checked = c.showBadge !== false;
  S.opaque.checked = c.opaque !== false;
  const errors = setLiveFromText(c.spec || "");
  syncTextFromLive();
  syncVisibility();
  if (mode === "editor") renderEditorRows();
  render();
  fit();
  if (errors.length) showErrors(errors);
}

function setColour(hex){ S.colour.value = hex; S.hex.value = hex; }

function syncVisibility(){
  const l = S.layout.value;
  $("closedField").style.display = l === "loop"  ? "" : "none";
  $("spacingOut").textContent = S.spacing.value;
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
  if (layoutVal !== "loop"){
    const dirSel = document.createElement("select");
    dirSel.className = "brDir";
    const opts = layoutVal === "vertical" ? [["right","branches right"],["left","branches left"]]
                                           : [["down","branches down"],["up","branches up"]];
    dirSel.innerHTML = opts.map(([v,l]) => `<option value="${v}">${l}</option>`).join("");
    dirSel.value = b.dir || opts[0][0];
    dirSel.onchange = () => { b.dir = dirSel.value; syncTextFromLive(); render(); };
    head.appendChild(dirSel);
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

/* ------------------------------------------------------------------ exports */
function serialize(){
  if (!current) return null;
  const clone = current.svg.cloneNode(true);
  clone.setAttribute("width",  Math.ceil(current.width));
  clone.setAttribute("height", Math.ceil(current.height));
  clone.setAttribute("xmlns", SVGNS);
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

$("dlSvg").onclick = () => {
  const s = serialize();
  if (s) download(new Blob([s], { type:"image/svg+xml" }), slug() + ".svg");
};

$("dlPng").onclick = () => {
  const s = serialize();
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
    showBadge:c.showBadge, opaque:c.opaque, spec:S.spec.value
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
function save(){
  try {
    localStorage.setItem(KEY, JSON.stringify({
      name:S.name.value, code:S.code.value, colour:S.colour.value, layout:S.layout.value,
      spacing:S.spacing.value, closed:S.closed.checked,
      showCodes:S.showCodes.checked, showIc:S.showIc.checked,
      showBadge:S.showBadge.checked, opaque:S.opaque.checked, spec:S.spec.value
    }));
  } catch (e){ /* storage disabled — no problem */ }
}

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
S.spacing.addEventListener("input", () => { $("spacingOut").textContent = S.spacing.value; render(); });
S.layout.addEventListener("change", () => {
  S.spacing.value = SPACING_DEFAULT[S.layout.value] || 100;
  syncVisibility();
  if (mode === "editor") renderEditorRows();
  render(); fit();
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
$("modeEditorBtn").onclick = () => setMode("editor");
$("modeTextBtn").onclick = () => setMode("text");

PRESET_META.forEach(p => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "presetBtn"; b.title = p.label;
  const cap = document.createElement("span");
  cap.className = "presetCap"; cap.style.background = p.colour; cap.textContent = p.acr;
  b.appendChild(cap);
  b.appendChild(document.createTextNode(p.label));
  b.onclick = () => { const ex = EXAMPLES[p.key]; if (ex) applyConfig(ex); };
  $("presetRow").appendChild(b);
});

$("zoomIn").onclick  = () => setZoom(zoom * 1.25);
$("zoomOut").onclick = () => setZoom(zoom / 1.25);
$("zoomFit").onclick = fit;
$("main").addEventListener("wheel", e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1/1.1));
}, { passive:false });

/* --------------------------------------------------------------------- theme */
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  $("themeToggle").textContent = t === "dark" ? "☀️ Light" : "🌙 Dark";
  try { localStorage.setItem("theme", t); } catch (e){}
}
$("themeToggle").onclick = () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
};
let savedTheme = null;
try { savedTheme = localStorage.getItem("theme"); } catch (e){}
applyTheme(savedTheme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

/* ------------------------------------------------------------------- startup */
let boot = null;
try { boot = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e){}
applyConfig(boot || EXAMPLES.cc);

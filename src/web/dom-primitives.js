/* DOM and SVG construction primitives shared by the operator console. */

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    // <textarea> has no `value` content attribute — its value is its child text —
    // so setAttribute("value", …) silently produces an empty box. Assign the
    // property instead; on a freshly created <input> that is equivalent.
    else if (k === "value") node.value = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v);
    } else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ---------- inline SVG icon vocabulary ----------
   One coherent line-art set, built with the SVG DOM (never innerHTML). Every
   icon shares the same 24×24 grid, currentColor stroke, and round joins so the
   console reads as one drawn language. Unfamiliar marks (linked / observed /
   quarantine / broadcast) are always paired with a text label or title. */

export const SVGNS = "http://www.w3.org/2000/svg";

export function svgChild(spec) {
  const node = document.createElementNS(SVGNS, spec[0]);
  for (const [k, v] of Object.entries(spec[1] || {})) if (v != null) node.setAttribute(k, String(v));
  return node;
}

/* SVG has no `title` content attribute — a shape's tooltip and accessible name
   come from a <title> CHILD element. setAttribute("title", …) on a <rect> is
   inert, which is why the usage bars used to hover-report nothing. */
export function svgTitle(text) {
  const node = document.createElementNS(SVGNS, "title");
  node.textContent = text;
  return node;
}

/* Instrument-panel glyph set — mixing-console / oscilloscope language rather than
   clinical warning-triangle + info slop. Marks are built from straight rails,
   nodes (LEDs), and peaks so severity reads as shape, not flood color. Angular
   shapes use miter joins locally; connectors/waveforms keep the round default. */
const ICON_PATHS = {
  // patch-bay link: two jack nodes joined by a rail
  linked: [["circle", { cx: 6, cy: 12, r: 2.4 }], ["circle", { cx: 18, cy: 12, r: 2.4 }], ["line", { x1: 8.4, y1: 12, x2: 15.6, y2: 12 }]],
  // monitor / observe: aperture lens
  observed: [["path", { d: "M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z" }], ["circle", { cx: 12, cy: 12, r: 2.4 }]],
  // isolate: angular shield + latch
  quarantine: [["path", { d: "M12 2.8 4.5 5.5v5.3c0 4.4 3.1 7.6 7.5 8.9 4.4-1.3 7.5-4.5 7.5-8.9V5.5z", "stroke-linejoin": "miter" }], ["rect", { x: 9.3, y: 11, width: 5.4, height: 4.4, rx: 0.4 }], ["path", { d: "M10.5 11V9.6a1.5 1.5 0 0 1 3 0V11" }]],
  // intervention: peak bar driven to the rail + LED base
  intervention: [["line", { x1: 12, y1: 4.5, x2: 12, y2: 13.5, "stroke-width": 2.6 }], ["rect", { x: 10.7, y: 16.6, width: 2.6, height: 2.6, fill: "currentColor", stroke: "none" }]],
  // advisory: caution diamond (no clinical triangle) with peak stem + LED
  warning: [["path", { d: "M12 2.8 21.2 12 12 21.2 2.8 12z", "stroke-linejoin": "miter" }], ["line", { x1: 12, y1: 7.6, x2: 12, y2: 12.8, "stroke-width": 2 }], ["rect", { x: 11, y: 15, width: 2, height: 2, fill: "currentColor", stroke: "none" }]],
  // cog for the Evidence disclosure — a settings-flavored "more machinery" mark
  gear: [
    ["circle", { cx: 12, cy: 12, r: 3 }],
    ["path", { d: "M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M5.1 18.9l1.6-1.6M17.3 6.7l1.6-1.6" }],
  ],
  // resolved: crisp confirm tick
  check: [["polyline", { points: "4.5 12.5 9.5 17.5 19.5 6.5", "stroke-linejoin": "miter" }]],
  // rename: nib + trim edge
  rename: [["path", { d: "M4 20.5h4l10.3-10.3-4-4L4 16.5z", "stroke-linejoin": "miter" }], ["line", { x1: 13.5, y1: 7, x2: 17.5, y2: 11 }]],
  // broadcast: transmit node with radiating carrier arcs
  broadcast: [["circle", { cx: 12, cy: 12, r: 2.1, fill: "currentColor", stroke: "none" }], ["path", { d: "M8.2 8.2a5.5 5.5 0 0 0 0 7.6" }], ["path", { d: "M15.8 8.2a5.5 5.5 0 0 1 0 7.6" }], ["path", { d: "M5.4 5.4a9.5 9.5 0 0 0 0 13.2" }], ["path", { d: "M18.6 5.4a9.5 9.5 0 0 1 0 13.2" }]],
  close: [["line", { x1: 6, y1: 6, x2: 18, y2: 18 }], ["line", { x1: 18, y1: 6, x2: 6, y2: 18 }]],
  caret: [["polyline", { points: "9 6 15 12 9 18" }]],
  // offline: dark node, severed rail
  offline: [["circle", { cx: 12, cy: 12, r: 9 }], ["line", { x1: 8, y1: 12, x2: 16, y2: 12 }]],
  // focus: jump-to-pane crosshair
  focus: [["circle", { cx: 12, cy: 12, r: 3 }], ["line", { x1: 12, y1: 3, x2: 12, y2: 7 }], ["line", { x1: 12, y1: 17, x2: 12, y2: 21 }], ["line", { x1: 3, y1: 12, x2: 7, y2: 12 }], ["line", { x1: 17, y1: 12, x2: 21, y2: 12 }]],
  // interrupt: pause bars
  interrupt: [["rect", { x: 7, y: 5.5, width: 3.4, height: 13, rx: 0.6 }], ["rect", { x: 13.6, y: 5.5, width: 3.4, height: 13, rx: 0.6 }]],
  // archive: tray
  archive: [["path", { d: "M4 7h16v11.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z", "stroke-linejoin": "miter" }], ["line", { x1: 2.5, y1: 7, x2: 21.5, y2: 7 }], ["line", { x1: 9, y: 12, x2: 15, y2: 12 }]],
};

export function icon(name, opts = {}) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "ico" + (opts.class ? " " + opts.class : ""));
  if (opts.label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", opts.label); }
  else svg.setAttribute("aria-hidden", "true");
  for (const spec of ICON_PATHS[name] || ICON_PATHS.warning) svg.append(svgChild(spec));
  return svg;
}

/* SVG bar meter — width via geometry attributes, never inline style, so the
   strict CSP (style-src 'self') permits it. */
export function svgMeter(pct, cls, opts = {}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone = clamped >= 92 ? " hot" : clamped >= 75 ? " warn" : "";
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 8");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", cls);
  svg.setAttribute("role", "progressbar");
  svg.setAttribute("aria-valuemin", "0");
  svg.setAttribute("aria-valuemax", "100");
  svg.setAttribute("aria-valuenow", String(Math.round(clamped)));
  if (opts.label) svg.setAttribute("aria-label", opts.label);
  const track = svgChild(["rect", { x: 0, y: 0, width: 100, height: 8, rx: 4, class: opts.trackClass || "tm-track" }]);
  const fill = svgChild(["rect", { x: 0, y: 0, width: clamped, height: 8, rx: 4, class: (opts.fillClass || "tm-fill") + tone }]);
  svg.append(track, fill);
  return svg;
}

/* Sparkline geometry, separated from the drawing so the part that decides WHERE
   the line breaks can be tested without a DOM. Returns one array of point
   strings per unbroken run, empty when there is nothing worth drawing. */
/* SVG sparkline — <polyline> runs whose points are geometry attributes, never
   inline style, so the strict CSP (style-src 'self') permits it. Returns null
   below two points — a single dot is not a trend and would only fake one.

   A non-finite value is a HOLE, not an absent element. It used to be filtered
   out before the geometry was computed, which did two things: the line closed
   over the gap so an unmeasured stretch looked continuous, and because x is the
   array index, dropping a value silently restretched every point after it — the
   chart rescaled its own time axis. Positions now come from the full array and
   the stroke breaks at each hole, so a gap reads as a gap. */
export function sparklineSegments(values) {
  const all = Array.isArray(values) ? values : [];
  const finite = all.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return [];
  const width = 100;
  const height = 24;
  const max = Math.max(...finite, 1);
  // Spacing over the whole series, so a hole keeps its place on the axis.
  const step = all.length > 1 ? width / (all.length - 1) : width;
  const at = (v, i) =>
    (i * step).toFixed(1) + "," + (height - 2 - (Math.max(0, v) / max) * (height - 4)).toFixed(1);
  const runs = [];
  let run = [];
  all.forEach((v, i) => {
    if (Number.isFinite(v)) { run.push(at(v, i)); return; }
    if (run.length) runs.push(run);
    run = [];
  });
  if (run.length) runs.push(run);
  /* A lone measurement between two holes is still a measurement: duplicating its
     coordinate under a round cap draws it as a dot rather than dropping it. */
  return runs.map((segment) => (segment.length === 1 ? [segment[0], segment[0]] : segment));
}

export function svgSparkline(values, opts = {}) {
  const runs = sparklineSegments(values);
  if (runs.length === 0) return null;
  const width = 100;
  const height = 24;
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", opts.class || "pulse-spark");
  if (opts.label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", opts.label); }
  else svg.setAttribute("aria-hidden", "true");
  for (const segment of runs) {
    svg.append(svgChild(["polyline", {
      points: segment.join(" "), fill: "none", stroke: "currentColor",
      "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round",
    }]));
  }
  return svg;
}

/* Segmented SVG meter — one contiguous bar split into proportional bands, each a
   rect whose width is a geometry attribute (never inline style, so the strict
   CSP holds). segments = [{ cls, value }]; zero-value bands are skipped. */
export function svgSegmentMeter(segments, opts = {}) {
  const total = segments.reduce((sum, seg) => sum + Math.max(0, seg.value), 0);
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 8");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "dw-meter");
  svg.setAttribute("role", "img");
  if (opts.label) svg.setAttribute("aria-label", opts.label);
  let x = 0;
  if (total > 0) {
    for (const seg of segments) {
      const w = (Math.max(0, seg.value) / total) * 100;
      if (w <= 0) continue;
      svg.append(svgChild(["rect", { x, y: 0, width: w, height: 8, class: seg.cls }]));
      x += w;
    }
  }
  return svg;
}

/* SVG donut ring — filled arc length is a geometry attribute (stroke-dasharray
   on a circle whose circumference is 100), never inline style, so the strict CSP
   (style-src 'self') holds. Center % is an SVG <text>. */
export function svgRing(pct, opts = {}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const tone = clamped >= 92 ? " hot" : clamped >= 75 ? " warn" : "";
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("class", "vital-ring");
  svg.setAttribute("role", "progressbar");
  svg.setAttribute("aria-valuemin", "0");
  svg.setAttribute("aria-valuemax", "100");
  svg.setAttribute("aria-valuenow", String(clamped));
  if (opts.label) svg.setAttribute("aria-label", opts.label);
  svg.append(svgChild(["circle", { cx: 18, cy: 18, r: 15.915, class: "ring-track" }]));
  svg.append(svgChild(["circle", {
    cx: 18, cy: 18, r: 15.915, class: "ring-fill" + tone,
    "stroke-dasharray": clamped + " " + (100 - clamped),
  }]));
  const label = document.createElementNS(SVGNS, "text");
  label.setAttribute("x", "18");
  label.setAttribute("y", "18");
  label.setAttribute("class", "ring-pct");
  label.textContent = clamped + "%";
  svg.append(label);
  return svg;
}

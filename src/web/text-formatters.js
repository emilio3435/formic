/* Small text and elapsed-time formatters with no application-state dependency. */

/* At most three significant figures at every magnitude: "325.8M" beside
   "6.6M" beside "361k" made the tokens column shift precision between
   adjacent rows, and a column that cannot be compared by eye wastes its
   right alignment. */
export const fmtTok = (n) =>
  n >= 1e11 ? Math.round(n / 1e9) + "B"
  : n >= 1e10 ? (n / 1e9).toFixed(1) + "B"
  : n >= 1e9 ? (n / 1e9).toFixed(2) + "B"
  : n >= 1e8 ? Math.round(n / 1e6) + "M"
  : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);

export function fmtElapsed(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = ms / 1000;
  if (s < 90) return Math.round(s) + "s";
  if (s < 5400) return Math.round(s / 60) + "m";
  if (s <= 86400) return (s / 3600).toFixed(1) + "h";
  /* One decimal, threshold at the day itself (inclusive, so an exactly-24h
     usage window still reads "24.0h"). Math.round at a 36h threshold printed
     "2d" for a 36-hour span — a 33% overstatement — and could never print
     "1d" at all, while precision fell from three significant figures to one
     across a one-second boundary. */
  return (s / 86400).toFixed(1) + "d";
}

export function agoText(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return fmtElapsed(Date.now() - t) + " ago";
}

const MODEL_SHORT = [
  ["fable", "fable 5"], ["sol", "sol 5.6"], ["luna", "luna 5.6"],
];
// Anthropic families whose transcript id carries a version we want to keep
// (e.g. claude-opus-4-8 → "opus 4.8"), rather than collapsing to a bare label.
const ANTHROPIC_VERSIONED = ["opus", "sonnet", "haiku"];
/* A placeholder is not a model name. A collector writes a bracketed marker like
   `<synthetic>` for a session it manufactured, and absence words like "unknown"
   when it has no model at all. Both used to pass through unchanged into slots
   whose fallback reads "not reported" or "—" — the gap filled with something
   that reads like an answer. Null instead, so each caller's existing absence
   wording applies and the model is reported as what it is: not known. */
const MODEL_ABSENT = /^(?:unknown|unspecified|none|n\/a|null|undefined)$/i;
export function modelShort(m) {
  if (!m) return null;
  const raw = String(m).trim();
  if (!raw || /^<.*>$/.test(raw) || MODEL_ABSENT.test(raw)) return null;
  const low = raw.toLowerCase();
  for (const fam of ANTHROPIC_VERSIONED) {
    const at = low.indexOf(fam);
    if (at === -1) continue;
    // Trailing version group right after the family (e.g. "-4-8" → "4.8").
    const ver = low.slice(at + fam.length).match(/^[-_](\d+(?:[-_]\d+)*)/);
    return ver ? fam + " " + ver[1].replace(/[-_]/g, ".") : fam;
  }
  // Cursor-native Grok: keep the recognizable family + dotted version, dropping
  // effort/fast qualifiers (e.g. cursor-grok-4.5-high-fast → "grok 4.5").
  const grokAt = low.indexOf("grok");
  if (grokAt !== -1) {
    const ver = low.slice(grokAt + 4).match(/^-(\d+(?:\.\d+)*)/);
    return ver ? "grok " + ver[1] : "grok";
  }
  // Meta Spark (Muse): muse-spark-1.2 variants → "spark 1.2", bare "spark" → "spark".
  // Keep dotted version, drop effort/fast qualifiers (e.g. muse-spark-1.2-high-fast → "spark 1.2").
  const sparkAt = low.indexOf("spark");
  if (sparkAt !== -1) {
    const ver = low.slice(sparkAt + 5).match(/^[-_]?(\d+(?:[\.\-_]\d+)*)/);
    if (ver) return "spark " + ver[1].replace(/[-_]/g, ".");
    return "spark";
  }
  // Bare "muse" without spark (e.g. muse-1.2) — still surface as muse label.
  if (low.includes("muse")) {
    const ver = low.match(/muse[-_]?(\d+(?:[\.\-_]\d+)*)/);
    if (ver) return "muse " + ver[1].replace(/[-_]/g, ".");
    return "muse";
  }
  // Cursor-native Composer: flatten to "composer <version> <qualifier>" within
  // the 18-char bound (e.g. composer-2.5-fast → "composer 2.5 fast").
  const composerAt = low.indexOf("composer");
  if (composerAt !== -1) {
    const flat = low.slice(composerAt).replace(/[-_]/g, " ");
    return flat.length > 18 ? flat.slice(0, 17) + "…" : flat;
  }
  for (const [key, label] of MODEL_SHORT) if (low.includes(key)) return label;
  return raw.length > 18 ? raw.slice(0, 17) + "…" : raw;
}

export const PROVIDER_LABELS = { codex: "Codex", claude: "Claude", cursor: "Cursor", omp: "OMP", factory: "Factory", prime: "Prime" };
export const HARNESS_LABELS = PROVIDER_LABELS;
export const providerLabel = (p) => PROVIDER_LABELS[p] || p;
export const harnessLabel = providerLabel;

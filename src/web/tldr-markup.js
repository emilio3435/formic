/* Writer mini-markup → styled nodes. The writer is an agent transcript —
   untrusted input — so this is a tokenizer over three literal delimiters, not
   an HTML parser. Output text always travels through textContent. */
import { el } from "./dom-primitives.js";

const TOKEN = /(\*[^*]{1,80}\*|`[^`]{1,80}`|![^!]{1,80}!)/g;

export function tldrMarkupNodes(text) {
  const s = String(text ?? "");
  const nodes = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) nodes.push(el("span", { text: s.slice(last, m.index) }));
    const tok = m[0];
    const inner = tok.slice(1, -1);
    if (tok[0] === "*") nodes.push(el("strong", { text: inner }));
    else if (tok[0] === "`") nodes.push(el("span", { class: "mono", text: inner }));
    else nodes.push(el("span", { class: "is-alert", text: inner }));
    last = m.index + tok.length;
  }
  if (last < s.length) nodes.push(el("span", { text: s.slice(last) }));
  return nodes;
}

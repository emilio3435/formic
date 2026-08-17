/* Naming — the client's mirror of src/server/naming.ts.

   The server publishes each agent's resolved identity on the wire, so on a
   current snapshot this file decides nothing: the client reads `identity.name`
   and renders it. This exists for the one case where that field is absent — an
   archived row written before the field existed, which the History surface
   still has to name.

   It is a MIRROR, not a second opinion. That distinction is the whole point of
   the file. Naming has been re-forked in this codebase before and the fork was
   not visible: the server built a name from the working directory, this client
   rebuilt a different one behind a "contains · and is under 56 characters"
   heuristic, and the two disagreed on which name a row should carry — an agent
   deliberately named "Lifecycle Mapper" lost to the derived
   "Claude · the-mountain-main" because the client had no way to tell an
   authored name from a guessed one.

   So neither implementation owns the rules. They live in
   tests/fixtures/naming-truth-table.json, and tests/naming-parity.test.ts runs
   the same rows through both. A rule added here and forgotten there — or the
   reverse — fails that file, by name.

   Browser module: no imports, no node built-ins. `basename` and the home
   directory are therefore done by hand here rather than borrowed from
   node:path/node:os, which is the only intentional difference from the server
   and is confined to the two helpers below. */

export const MAX_NAME_LENGTH = 80;

export const PROVIDER_DISPLAY_NAMES = {
  codex: "Codex",
  omp: "OMP",
  claude: "Claude",
  cursor: "Cursor",
  factory: "Factory",
  prime: "Prime",
  grok: "Grok",
  hermes: "Hermes",
  muse: "Muse",
  antigravity: "Antigravity",
  copilot: "Copilot",
};

/* Strings that arrive in a name-shaped field but are not names: OMP's periodic
   status row, a transcript whose first content is an attachment, and Cursor's
   placeholder for a composer nobody has titled. */
const NOT_A_NAME = [
  /^session update(?:\s*\[.*\])?$/i,
  /^<file name=/i,
  /^new agent$/i,
];

function usableName(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return undefined;
  if (NOT_A_NAME.some((pattern) => pattern.test(trimmed))) return undefined;
  return trimmed;
}

function capped(name) {
  if (name.length <= MAX_NAME_LENGTH) return name;
  return name.slice(0, MAX_NAME_LENGTH - 1).trimEnd() + "…";
}

/* node:path's basename, for a client that cannot import it. Trailing slashes
   are stripped first so that two spellings of one path cannot become two
   names — the freeze is worthless if "/Users/ant" and "/Users/ant/" disagree. */
function trimTrailingSlashes(path) {
  return String(path || "").replace(/\/+$/, "");
}

function baseName(path) {
  const segments = path.split("/");
  return segments.length ? segments[segments.length - 1] : path;
}

function originCwdName(provider, originCwd, homeDir) {
  const normalized = trimTrailingSlashes(originCwd);
  if (!normalized) return undefined;
  const folder = normalized === trimTrailingSlashes(homeDir) ? "Home" : baseName(normalized);
  if (!folder) return undefined;
  return (PROVIDER_DISPLAY_NAMES[provider] || provider) + " · " + folder;
}

/* Decide one session's name from its evidence. Row order is the precedence
   order in the contract: first match wins.

   `homeDir` has no default here. The server can ask the operating system;
   a browser cannot, and guessing "" would silently name every home-directory
   session after the last path segment of nothing. The caller supplies it. */
export function resolveAgentName(evidence, homeDir) {
  if (!evidence) return { name: "", base: "", source: "provider-fallback" };
  const provider = evidence.provider;

  // Tier 1 — an operator said what this is called.
  const alias = usableName(evidence.operatorAlias && evidence.operatorAlias.agent)
    || usableName(evidence.operatorAlias && evidence.operatorAlias.workspace);
  if (alias) return { name: capped(alias), base: capped(alias), source: "operator-alias" };

  // Tier 2 — a declared orchestrator uses the run id; workers use the lane id.
  const manifest = usableName(evidence.manifest && (
    evidence.manifest.role === "orchestrator"
      ? evidence.manifest.runId
      : evidence.manifest.laneId
  ));
  if (manifest) {
    return {
      name: capped(manifest),
      base: capped(manifest),
      source: "manifest",
      authoredBy: "manifest",
    };
  }

  // Tier 3 — whoever launched the agent named it.
  const authored = usableName(evidence.authored && evidence.authored.name);
  if (authored) {
    return {
      name: capped(authored),
      base: capped(authored),
      source: "authored",
      authoredBy: evidence.authored.by,
    };
  }

  // Tier 4 — nobody named it, so say what it is and where it began.
  const origin = originCwdName(provider, evidence.originCwd, homeDir);
  if (origin) return { name: capped(origin), base: capped(origin), source: "origin-cwd" };

  // Tier 5 — the task line is the last thing that carries meaning.
  const task = usableName(evidence.taskName);
  if (task) return { name: capped(task), base: capped(task), source: "task" };

  // Tier 6 — nothing is known but which provider it is.
  const fallback = (PROVIDER_DISPLAY_NAMES[provider] || provider) + " session";
  return { name: fallback, base: fallback, source: "provider-fallback" };
}

/* The TAIL of the session id, not the head. Codex issues UUIDv7 whose leading
   segment is a timestamp, so every session started in the same minute shares
   it — tagging by prefix put "#019fb496" on four different rows. */
export function sessionTag(sourceSessionId) {
  const trimmed = String(sourceSessionId || "").trim();
  if (!trimmed) return "";
  const segments = trimmed.split("-").filter(Boolean);
  const tail = segments.length ? segments[segments.length - 1] : trimmed;
  return tail.slice(-8);
}

/* Give every session in the list a name no other session in the list has.
   Returns identities parallel to `entries`; a base nobody shares is returned
   untouched. A tag that is itself shared escalates to the whole session id,
   because a disambiguator that settles nothing looks like it settled something. */
export function disambiguate(entries) {
  const list = entries || [];
  const counts = new Map();
  for (const entry of list) {
    counts.set(entry.identity.base, (counts.get(entry.identity.base) || 0) + 1);
  }

  const escalated = new Set();
  const tagsByBase = new Map();
  for (const entry of list) {
    if ((counts.get(entry.identity.base) || 0) < 2) continue;
    const tags = tagsByBase.get(entry.identity.base) || new Map();
    const tag = sessionTag(entry.sourceSessionId);
    tags.set(tag, (tags.get(tag) || 0) + 1);
    tagsByBase.set(entry.identity.base, tags);
  }
  for (const [base, tags] of tagsByBase) {
    for (const [tag, count] of tags) if (count > 1) escalated.add(base + " " + tag);
  }

  return list.map((entry) => {
    const identity = entry.identity;
    if ((counts.get(identity.base) || 0) < 2) return identity;
    const tag = sessionTag(entry.sourceSessionId);
    const unique = escalated.has(identity.base + " " + tag)
      ? String(entry.sourceSessionId || "").trim()
      : tag;
    /* Nothing stable to separate them by. A tag derived from position would
       change between refreshes, which is the bug this module exists to remove,
       so the duplicate stays visible rather than being papered over. */
    if (!unique) return identity;
    return Object.assign({}, identity, {
      name: identity.base + " #" + unique,
      disambiguator: unique,
    });
  });
}

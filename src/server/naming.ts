import { basename } from "node:path";
import { homedir } from "node:os";
import type { AgentIdentity, AgentRole, AuthoredNameSource, NameSource, Provider } from "../shared/types";

/* Re-exported so this module reads as the home of naming even though the types
   themselves live in shared/: they travel on the wire, and the client cannot
   import from src/server/. */
export type { AgentIdentity, AuthoredNameSource, NameSource };

/* The one place an agent's name is decided.

   Before this module the same question was answered in three places that did
   not agree, and none of them could produce a unique answer. `makeAgent` in
   collectors.ts built a name out of whatever the shell's working directory
   happened to be at parse time; `sourceAgentName` in presentation.js rebuilt a
   different one on the client, gated behind a heuristic that a name is only
   trustworthy if it contains "·" and is under 56 characters; `agentName`
   layered cmux pane titles on top of that. Measured on the live board on
   2026-08-04: 821 sessions, 51 distinct names, 805 of them (98%) sharing a name
   with at least one other session, and 360 sharing the single name
   "Claude · the-mountain-main".

   Two properties were missing, and this module exists to supply them.

   The first is that a name must be authored, not inferred. A folder is not a
   name — every lane in a worktree tree is a sibling directory, so deriving the
   name from the folder guarantees collisions between exactly the sessions an
   operator most needs to tell apart. When somebody bothered to say what an
   agent is called, that beats anything computed from the filesystem.

   The second is that a name must not move. `makeAgent` read the LATEST cwd
   recorded in the transcript, and a Claude transcript records cwd per entry, so
   the name followed the shell. Reproduced on the session that wrote this file:
   six recorded cwd changes in four minutes, four renames, all from read-only
   `git` and `ls` commands — and at 09:23Z it was published under a DIFFERENT
   lane's name. Identity here derives from the FIRST cwd a session recorded,
   which is a property of an append-only file and therefore returns the same
   answer on every parse, incremental or cold.

   Uniqueness is not a property any single session has, so it cannot be decided
   here. `resolveAgentName` answers for one session; `disambiguate` is given the
   whole fleet at once and is the only thing allowed to append a tag. */

/* The one shared cap. `program-aliases.ts` already refuses an operator label
   longer than this, so a derived name that could exceed it would be a name the
   operator is forbidden to reproduce by hand. */
export const MAX_NAME_LENGTH = 80;

export interface NameEvidence {
  provider: Provider;
  /** The provider's own session id. Only ever read to build a disambiguator. */
  sourceSessionId: string;
  /**
   * Operator labels, already looked up by key. `agent` outranks `workspace`
   * because a workspace label names a cmux pane, and sibling panes share one —
   * renaming by workspace renames every sibling at once.
   */
  operatorAlias?: { agent?: string; workspace?: string };
  /** A lane/run name declared before the session started. */
  manifest?: { runId: string; laneId: string; role: AgentRole };
  /** A name somebody chose when launching this agent. */
  authored?: { name: string; by: AuthoredNameSource };
  /**
   * The FIRST working directory this session recorded — never the latest.
   * Collectors keep `cwd` current for routing; only the name reads this.
   */
  originCwd?: string;
  /**
   * The distilled task line, when the collector produced one. Passed in rather
   * than re-derived: `taskDisplayName` in collectors.ts strips harness noise,
   * handoff markers and markdown, and that logic stays where it lives.
   */
  taskName?: string;
}

/* The provider's name as an operator says it out loud. collectors.ts holds a
   private copy of this map today; it becomes an import of this one when the
   collector is wired to this module, so that there is one spelling of "OMP". */
export const PROVIDER_DISPLAY_NAMES: Record<Provider, string> = {
  codex: "Codex",
  omp: "OMP",
  claude: "Claude Code",
  cursor: "Cursor",
  factory: "Factory",
  prime: "Prime",
  grok: "Grok Build",
  hermes: "Hermes",
  muse: "Muse Code",
  antigravity: "Antigravity",
  copilot: "Copilot CLI",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  pi: "Pi",
};

/* Strings that arrive in a name-shaped field but are not names. Each was
   observed on the live board, and each is the source's own boilerplate rather
   than anything a human chose:

   - "Session update" / "Session update [...]" — OMP's periodic status row.
   - "<file name=..." — a transcript whose first content is an attachment.
   - "new agent" — Cursor's placeholder for a composer nobody has titled
     (`genericCursorName`, cursor.ts:124-126).

   Rejecting them here rather than at each call site is the point: three
   providers previously each rejected a different subset. */
const NOT_A_NAME = [
  /^session update(?:\s*\[.*\])?$/i,
  /^<file name=/i,
  /^new agent$/i,
];

function usableName(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (NOT_A_NAME.some((pattern) => pattern.test(trimmed))) return undefined;
  return trimmed;
}

/* A cmux pane title, but only when a human plausibly typed it.

   Factory says outright whether its title was set by hand
   (`isSessionTitleManuallySet`); cmux publishes no such flag and titles EVERY
   pane, so the distinction has to be read off the title itself. Its defaults
   are the account name, the pane's folder, and the folder path — all of which
   read like names, and all of which would outrank the fleet's own answer if
   accepted. Measured on the live board 2026-08-04: a pane titled
   "emilionunezgarcia" replaced the distilled "Ant Hill Naming & Lifecycle
   Investigation".

   The rule is "echoes THIS pane's folder", not "looks like a folder": an
   operator who titles a pane after the project it works on, from somewhere
   else, meant it. */
export function paneRename(
  title?: string,
  paneCwd?: string,
  homeDir: string = homedir(),
): string | undefined {
  const trimmed = title?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("~") || trimmed.startsWith("/")) return undefined;
  const echoes = (candidate?: string): boolean => {
    const name = candidate ? basename(candidate.replace(/\/+$/, "")) : "";
    return name !== "" && name.toLowerCase() === trimmed.toLowerCase();
  };
  if (echoes(homeDir) || echoes(paneCwd)) return undefined;
  return usableName(trimmed);
}

/* One cap, applied to every tier. A derived name is allowed to be as long as a
   name an operator could type and no longer. */
function capped(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  return `${name.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
}

/* The honest fallback: which provider, and where it started. "Home" rather than
   the literal home directory's basename, because the basename of $HOME is a
   username and naming every session after the operator tells nobody anything. */
function originCwdName(
  provider: Provider,
  originCwd: string | undefined,
  homeDir: string,
): string | undefined {
  const normalized = originCwd?.replace(/\/+$/, "");
  if (!normalized) return undefined;
  const folder = normalized === homeDir.replace(/\/+$/, "") ? "Home" : basename(normalized);
  if (!folder) return undefined;
  return `${PROVIDER_DISPLAY_NAMES[provider]} · ${folder}`;
}

/**
 * Decide one session's name from its evidence. Row order below is the
 * precedence order in the contract: the first match wins, and every earlier row
 * outranks every later one.
 *
 * The returned identity carries no disambiguator — uniqueness is a fleet
 * property, and `disambiguate` is the only thing that can see the fleet.
 */
export function resolveAgentName(
  evidence: NameEvidence,
  homeDir: string = homedir(),
): AgentIdentity {
  // Tier 1 — an operator said what this is called. Human intent outranks every
  // machine fact, exactly as an operator archive outranks a live process in the
  // lifecycle contract.
  const alias = usableName(evidence.operatorAlias?.agent)
    ?? usableName(evidence.operatorAlias?.workspace);
  if (alias) {
    return { name: capped(alias), base: capped(alias), source: "operator-alias" };
  }

  // Tier 2 — the run declaration named the lane before it started. The run id
  // names its orchestrator; workers use the narrower lane id.
  const manifest = usableName(
    evidence.manifest?.role === "orchestrator"
      ? evidence.manifest.runId
      : evidence.manifest?.laneId,
  );
  if (manifest) {
    return {
      name: capped(manifest),
      base: capped(manifest),
      source: "manifest",
      authoredBy: "manifest",
    };
  }

  // Tier 3 — whoever launched the agent named it. An orchestrator that assigns
  // "Identity Name Tracer" has stated a fact about the agent; a folder has not.
  // launch-env is the exception: it is leftover from launch or the first
  // naming pass, and a later task on a resumed pane is the work happening now.
  const authored = usableName(evidence.authored?.name);
  const laterTask = evidence.authored?.by === "launch-env"
    ? usableName(evidence.taskName)
    : undefined;
  if (authored && evidence.authored && !laterTask) {
    return {
      name: capped(authored),
      base: capped(authored),
      source: "authored",
      authoredBy: evidence.authored.by,
    };
  }
  if (laterTask) {
    return { name: capped(laterTask), base: capped(laterTask), source: "task" };
  }

  // Tier 4 — nobody named it, so say what it is and where it began.
  const origin = originCwdName(evidence.provider, evidence.originCwd, homeDir);
  if (origin) {
    return { name: capped(origin), base: capped(origin), source: "origin-cwd" };
  }

  // Tier 5 — no name and no directory; the task line is the last thing that
  // carries meaning.
  const task = usableName(evidence.taskName);
  if (task) {
    return { name: capped(task), base: capped(task), source: "task" };
  }

  // Tier 6 — nothing at all is known but which provider it is.
  const fallback = `${PROVIDER_DISPLAY_NAMES[evidence.provider]} session`;
  return { name: fallback, base: fallback, source: "provider-fallback" };
}

/* The short form of a session id, used as the uniqueness tag.

   The TAIL, not the head. Codex issues UUIDv7, whose leading segment is a
   timestamp — every session started in the same minute shares it. Tagging by
   prefix produced "#019fb496" on four different rows and disambiguated nothing;
   on the live board 20 of 27 duplicate-name groups collided that way. The
   trailing segment is the random part, so it is what actually separates two
   sessions. Ported from the client, where it was verified against 213 live
   agents with no collisions. */
export function sessionTag(sourceSessionId: string): string {
  const trimmed = sourceSessionId.trim();
  if (!trimmed) return "";
  const segments = trimmed.split("-").filter(Boolean);
  const tail = segments.length ? segments[segments.length - 1]! : trimmed;
  return tail.slice(-8);
}

export interface NameEntry {
  /** Full durable id (`provider:sourceSessionId`) used only for sticky tags. */
  agentId?: string;
  sourceSessionId: string;
  identity: AgentIdentity;
}

export interface NameTagAssignment {
  agentId: string;
  tag: string;
}

export interface NameTagStore {
  getNameTag?(agentId: string): string | undefined;
  rememberNameTags?(assignments: readonly NameTagAssignment[]): Promise<void>;
}

/**
 * Give every session in the fleet a name no other session in the fleet has.
 *
 * Returns identities parallel to `entries`. A session whose base name nobody
 * else shares is returned untouched — a tag on every row would be noise on a
 * board where most names should end up distinct once tiers 1 and 2 are wired.
 *
 * This runs server-side, over the whole fleet, for a reason: notifications and
 * the action log receive ids only, and the roster, lineage and broadcast chips
 * never had the client's per-paint duplicate set threaded into them. Those
 * surfaces showed the ambiguous name with nothing to separate it. Computing the
 * answer once, where every agent is already in one array, is also the only way
 * an archived row can carry its tag frozen into History.
 */
function fleetDisambiguate(entries: readonly NameEntry[]): AgentIdentity[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.identity.base, (counts.get(entry.identity.base) ?? 0) + 1);
  }

  /* A tag that is itself shared settles nothing, and acceptance turns on no two
     sessions sharing a name — so within a colliding group, a colliding tag
     escalates to the whole session id. Deterministic: it depends on the ids in
     the group, never on their order or on how many times this has run. */
  const escalated = new Set<string>();
  const tagsByBase = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    if ((counts.get(entry.identity.base) ?? 0) < 2) continue;
    const tags = tagsByBase.get(entry.identity.base) ?? new Map<string, number>();
    const tag = sessionTag(entry.sourceSessionId);
    tags.set(tag, (tags.get(tag) ?? 0) + 1);
    tagsByBase.set(entry.identity.base, tags);
  }
  for (const [base, tags] of tagsByBase) {
    for (const [tag, count] of tags) if (count > 1) escalated.add(`${base} ${tag}`);
  }

  return entries.map((entry) => {
    const { identity } = entry;
    if ((counts.get(identity.base) ?? 0) < 2) return identity;
    const tag = sessionTag(entry.sourceSessionId);
    const unique = escalated.has(`${identity.base} ${tag}`)
      ? entry.sourceSessionId.trim()
      : tag;
    /* Nothing stable to separate them by. Inventing one from position would
       change the name between refreshes, which is the bug this module exists to
       remove, so the duplicate is left visible instead of papered over. */
    if (!unique) return identity;
    return { ...identity, name: `${identity.base} #${unique}`, disambiguator: unique };
  });
}

/* The fleet calculation remains the source of a first tag. Once an agent has
   one, the durable store wins even if later snapshots contain fewer peers or
   would choose the longer collision fallback. */
export function disambiguate(
  entries: readonly NameEntry[],
  store?: NameTagStore,
): AgentIdentity[] {
  const computed = fleetDisambiguate(entries);
  const assignments: NameTagAssignment[] = [];
  const identities = computed.map((identity, index) => {
    const entry = entries[index]!;
    const remembered = entry.agentId ? store?.getNameTag?.(entry.agentId)?.trim() : undefined;
    if (remembered) {
      return {
        ...entry.identity,
        name: `${entry.identity.base} #${remembered}`,
        disambiguator: remembered,
      };
    }
    if (entry.agentId && identity.disambiguator) {
      assignments.push({ agentId: entry.agentId, tag: identity.disambiguator });
    }
    return identity;
  });
  if (assignments.length && store?.rememberNameTags) {
    void store.rememberNameTags(assignments).catch((error) => {
      console.error(`[Names] could not persist disambiguators: ${String(error)}`);
    });
  }
  return identities;
}

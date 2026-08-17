/* Program resolution: how a loose fleet of agent sessions becomes the grouped,
   ordered board an operator reads.

   Three jobs. programFor decides which program an agent belongs to, preferring
   an explicitly configured hint over anything inferred, and falling back to the
   checkout directory so an unconfigured agent still lands somewhere honest
   rather than in a bucket called "unassigned". rollupFor counts a program's
   agents into the badges on its header. agentSortRank is the row order —
   failures first, then things wanting a human, then live work.

   ProgramHint lives here because this is the only code that reads it;
   snapshot.ts re-exports it so state.ts does not have to move. */

import { homedir } from "node:os";
import { basename } from "node:path";
import type {
  AgentAck,
  AgentSnapshot,
  OutcomeState,
  ProgramRollup,
  ProgramSnapshot,
  RepoIdentity,
} from "../shared/types";
import { fnvKey } from "./repo-identity";
import { isLive } from "./live";
import { agentIsStripAlerting } from "./strip-alerting";
import type { CmuxSurface, CollectedAgent } from "./types";

export interface ProgramHint {
  id: string;
  name: string;
  purpose?: string;
  path?: string;
  match: string[];
}

function hash(value: string): string {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(36);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unassigned";
}

export function rollupFor(
  agents: readonly AgentSnapshot[],
  nowMs = Date.now(),
  acks: readonly AgentAck[] = [],
): ProgramRollup {
  const outcomeCount = (outcome: OutcomeState): number => agents.filter((agent) => agent.outcome === outcome).length;
  return {
    total: agents.length,
    /* Stall-aware live. idle/working keep their wire names (schema-2 to rename
       idle→waiting). live ⊆ working ∪ waiting_fresh ∪ needs_you. */
    live: agents.filter((agent) => isLive(agent, nowMs)).length,
    working: agents.filter((agent) => agent.activity === "working").length,
    idle: agents.filter((agent) => agent.activity === "idle").length,
    ended: agents.filter((agent) => agent.activity === "ended").length,
    /* The exact unacked alert-strip population. Failures and explicit asks are
       both alerting; Ack removes either from this digit without rewriting the
       underlying agent state. System findings keep their own name in totals. */
    needsYou: agents.filter((agent) => agentIsStripAlerting(agent, acks)).length,
    blocked: outcomeCount("blocked"),
    failed: outcomeCount("failed"),
    linked: agents.filter((agent) => agent.controlState === "linked").length,
  };
}

export function agentSortRank(agent: AgentSnapshot): number {
  if (agent.outcome === "failed") return 0;
  if (agent.outcome === "needs-you") return 1;
  if (agent.outcome === "blocked") return 2;
  if (agent.activity === "working") return 3;
  if (agent.activity === "idle") return 4;
  return 5;
}

function configuredProgram(
  hints: readonly ProgramHint[],
  values: readonly (string | undefined)[],
): ProgramHint | undefined {
  return hints.find((hint) =>
    hint.match.some((needle) =>
      values.some((value) => value?.toLowerCase().includes(needle.toLowerCase())),
    ),
  );
}

/* A disposable checkout an automation made, not a project a human works in.

   `codex` with worktree isolation mints ~/.codex/worktrees/<hash>/<repo> per
   run, and the board grouped by the FULL path while naming by the last folder —
   so 270 automated runs became 179 program groups, 93 of them displaying the
   single word "elio-intelligence-suite" and 86 displaying "LaHormigaDormida".
   The History tab was mostly this, one identical row repeated.

   The path is the signal, deliberately: nobody navigates to a directory named
   after a random hash, so this needs no guess about intent and no matching
   against task prose (which would have caught the runs whose first line happens
   to say "autopilot" and missed the rest). Everything under one repo's
   ephemeral tree collapses into one program, however deep the session sat
   inside it — `<hash>/<repo>/desktop` is the same run as `<hash>/<repo>`. */
const EPHEMERAL_WORKTREE = /\/\.codex\/worktrees\/[^/]+\/([^/]+)/;

function ephemeralProgram(cwd: string): Omit<ProgramSnapshot, "agents"> | undefined {
  const repo = EPHEMERAL_WORKTREE.exec(cwd)?.[1];
  if (!repo) return undefined;
  return {
    id: `codex-worktrees-${slug(repo)}`,
    name: `${repo} · automation`,
    purpose: "Disposable Codex worktrees. One row per repository, not per run.",
  };
}

export function programFor(
  agent: CollectedAgent,
  hints: readonly ProgramHint[],
  surface?: CmuxSurface,
  allowSurfaceProjectEvidence = false,
  repo?: RepoIdentity,
): Omit<ProgramSnapshot, "agents"> {
  const configured =
    configuredProgram(hints, [agent.id]) ??
    (repo ? configuredProgram(hints, [repo.worktreePath, repo.repoKey]) : undefined) ??
    (allowSurfaceProjectEvidence ? configuredProgram(hints, [surface?.cwd, surface?.workspaceTitle]) : undefined) ??
    (!repo ? configuredProgram(hints, [agent.cwd]) : undefined) ??
    configuredProgram(hints, [agent.task, agent.displayName]);
  if (configured) {
    return { id: configured.id, name: configured.name, purpose: configured.purpose, path: configured.path };
  }
  if (repo) {
    if (repo.ephemeral) {
      return {
        id: `repo:${repo.repoKey}:ephemeral`,
        name: "disposable checkouts",
        groupPath: [repo.repoKey, "ephemeral"],
      };
    }
    const worktreeKey = fnvKey(repo.worktreePath);
    return {
      id: `repo:${repo.repoKey}:worktree:${worktreeKey}`,
      name: repo.repoName,
      path: repo.worktreePath,
      groupPath: [repo.repoKey, worktreeKey],
    };
  }
  const cwd = allowSurfaceProjectEvidence && surface?.cwd ? surface.cwd : agent.cwd;
  if (!cwd) return { id: `${agent.provider}-unassigned`, name: `${agent.provider.toUpperCase()} · No project` };
  /* After the configured hints, so an explicit program hint still wins — an
     operator who has named a program means it, whatever directory it ran in. */
  const ephemeral = ephemeralProgram(cwd);
  if (ephemeral) return ephemeral;
  const normalizedCwd = cwd.replace(/\/+$/, "");
  if (normalizedCwd === homedir().replace(/\/+$/, "")) {
    // cwd is literally ~ — not "unassigned", just not a project checkout.
    return { id: `cwd-home-${hash(normalizedCwd)}`, name: "Home", path: cwd };
  }
  const name = basename(cwd) || cwd;
  return { id: `cwd-${slug(name)}-${hash(cwd)}`, name, path: cwd };
}

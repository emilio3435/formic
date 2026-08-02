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
  AgentSnapshot,
  OutcomeState,
  ProgramRollup,
  ProgramSnapshot,
} from "../shared/types";
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

export function rollupFor(agents: readonly AgentSnapshot[]): ProgramRollup {
  const outcomeCount = (outcome: OutcomeState): number => agents.filter((agent) => agent.outcome === outcome).length;
  return {
    total: agents.length,
    live: agents.filter((agent) => agent.activity === "working" || agent.activity === "idle").length,
    working: agents.filter((agent) => agent.activity === "working").length,
    idle: agents.filter((agent) => agent.activity === "idle").length,
    ended: agents.filter((agent) => agent.activity === "ended").length,
    /* "Needs you" means AGENTS WAITING ON A HUMAN — the phrase the tab is named
       for and the only number on the board that is a to-do list.

       It used to count any agent whose outcome was not healthy, which is a
       different population: a failed or blocked session is a fact about the
       work, not a request for a person. Meanwhile totals.needsYou counted
       system findings and the client counted attention signals, so one phrase
       had three meanings and they could not agree. All three now read the same
       collection. System findings keep their own name in totals. */
    needsYou: agents.filter((agent) => Boolean(agent.attentionSignal)).length,
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

export function programFor(
  agent: CollectedAgent,
  hints: readonly ProgramHint[],
  surface?: CmuxSurface,
  exactSurface = false,
): Omit<ProgramSnapshot, "agents"> {
  const configured =
    configuredProgram(hints, [agent.cwd, agent.id]) ??
    (exactSurface ? configuredProgram(hints, [surface?.cwd, surface?.workspaceTitle]) : undefined) ??
    configuredProgram(hints, [agent.task, agent.displayName]);
  if (configured) {
    return { id: configured.id, name: configured.name, purpose: configured.purpose, path: configured.path };
  }
  const cwd = exactSurface && surface?.cwd ? surface.cwd : agent.cwd;
  if (!cwd) return { id: `${agent.provider}-unassigned`, name: `${agent.provider.toUpperCase()} · No project` };
  const normalizedCwd = cwd.replace(/\/+$/, "");
  if (normalizedCwd === homedir().replace(/\/+$/, "")) {
    // cwd is literally ~ — not "unassigned", just not a project checkout.
    return { id: `cwd-home-${hash(normalizedCwd)}`, name: "Home", path: cwd };
  }
  const name = basename(cwd) || cwd;
  return { id: `cwd-${slug(name)}-${hash(cwd)}`, name, path: cwd };
}

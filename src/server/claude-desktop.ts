import type {
  CmuxTarget,
  IdentityTrace,
  IdentityTraceStep,
} from "../shared/types";
import type { CollectedAgent } from "./types";

export const CLAUDE_DESKTOP_COPY = {
  cause: "This Claude Desktop surface has no attested write.",
  remedy: "Formic will not Send here until Anthropic ships an official write. Prefill is not Send.",
} as const;

export const CLAUDE_DESKTOP_INTERRUPT_REASON = "Claude Desktop has no attested stop RPC.";

export function isClaudeDesktopLaunch(launch?: { entrypoint?: string; promptSource?: string }): boolean {
  return launch?.entrypoint === "claude-desktop";
}

export function isClaudeDesktopTarget(target: Pick<CmuxTarget, "kind"> | undefined): boolean {
  return target?.kind === "claude-desktop";
}

export function isClaudeDesktopAgent(agent: {
  launch?: { entrypoint?: string; promptSource?: string };
  target?: Pick<CmuxTarget, "kind">;
}): boolean {
  if (isClaudeDesktopTarget(agent.target)) return true;
  return isClaudeDesktopLaunch(agent.launch);
}

export function resolveClaudeDesktopControlTarget(agent: CollectedAgent): {
  target: CmuxTarget;
  trace: IdentityTrace;
} {
  const target: CmuxTarget = {
    kind: "claude-desktop",
    resolution: "missing",
    reason: CLAUDE_DESKTOP_COPY.cause,
  };
  const step: IdentityTraceStep = {
    tier: "session",
    outcome: "rejected",
    detail: `${CLAUDE_DESKTOP_COPY.cause} ${CLAUDE_DESKTOP_COPY.remedy}`,
  };
  return {
    target,
    trace: {
      steps: [step],
      resolution: target.resolution,
      reason: target.reason,
    },
  };
}

export function lastKnownClaudeDesktopTarget(reason: string): CmuxTarget {
  return {
    kind: "claude-desktop",
    resolution: "missing",
    reason,
  };
}

export const CLAUDE_DESKTOP_FOCUS_APP = "Claude";

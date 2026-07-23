# The Ant Hill

A local-first, light-mode command center for direct Codex, Claude, and Cursor Agent work across cmux. Retained OMP records are read-only history, not part of the runtime stack. This rebuild is isolated from the live Mountain v2 service in `~/mountain`.

## Run locally

**Day to day (this is the whole workflow):**

```bash
bun start
```

That one command: reuses Ant Hill if it’s already up, otherwise starts it (prefers a cmux workspace, falls back to this shell). Open <http://127.0.0.1:4701>.

**Once per machine** (already done on this Mac if `data/cmux-socket.env` exists):

```bash
bun run setup:cmux
```

That saves a local cmux password so Ant Hill can see terminal names and use Focus/Send even when started outside cmux. You should not need to think about it again.

## Safety model

- Source session IDs and exact recorded working directories are preserved.
- cmux targets resolve from exact session/process evidence first and a unique cwd only as fallback.
- Ambiguous or missing targets have disabled controls with a visible reason.
- Controls accept a small structured action set and propagate the real cmux exit code and stderr.
- Mutating requests require an exact same-origin loopback `Origin`; arbitrary shell/spawn commands are outside the API.
- Unread cmux notifications are the source for operator-attention state.
- Archived cards retain their compact source record after the original provider file leaves the live scan window.

## Data truth

- Cursor Agent cards merge direct-CLI chat metadata with GUI agents from Cursor's local conversation index, project-membership state, model tracking, transcripts, and subagent records.
- Cursor child-agent transcripts are first-class parent-linked records. Reported Grok-family models are compliant, reported non-Grok models are violations, and missing model evidence stays visibly unverified.
- Cursor token totals and cost remain visibly unknown because the local Cursor records do not expose authoritative billing totals.
- Cursor GUI cards expose data only. Their cmux actions require exact terminal identity and never use cwd-only fallback.
- Injected agent instructions and transport envelopes are excluded from task names. Primary labels use the real assignment; source session IDs remain in card details.
- A source cwd of `~` stays visible as source truth. Presentation grouping may use configured task hints or an exact cmux surface, but never changes control routing.
- OMP is not an Ant Hill launch dependency. Its collector is archived, read-only compatibility for historical session records and can never appear as active runtime work.
- The primary token glance metric is the median latest request across working sessions. Per-session cumulative totals remain available in details and never inflate current-request usage.

## Summary message contract

`AgentSnapshot.lastHumanMessage` is `string | null`. Collectors choose the latest provider-shaped assistant or user prose after removing tool calls, diffs, structured envelopes, citations, commands, paths, and injected instructions; they then fall back to task text and a concise status reason. `null` is preserved as absence. The row helper `formatLastHumanMessage` bounds the display text and renders `No readable message yet` for null; `transcriptTail` remains technical inspector evidence and is never used as row summary text.

## Verification

`bun run check` runs strict TypeScript plus the collector, identity, routing, notification, archive, snapshot/SSE, control, lifecycle, web-client, and HTTP-boundary tests.

The exact 2026-07-22 commands, point-in-time results, browser checks, disposable cmux control proof, and review verdicts are preserved in [VERIFICATION.md](./VERIFICATION.md).

The staged implementation plan for model share, usage trends, request/response distributions, latency, coverage, and Cursor policy analytics is in [TOKEN-ANALYTICS-PLAN.md](./TOKEN-ANALYTICS-PLAN.md).

The direct, coordinated, and investigation flow—including explicit read-only Luna launch and persisted run states—is in [TRIAGE-WORKFLOW.md](./TRIAGE-WORKFLOW.md).

The live v2 launch agent, port 4700, and files under `~/mountain` remain unchanged. The local v3 process on port 4701 was refreshed to this build; no commit, push, external deployment, launchd edit, or port-4700 cutover was performed.

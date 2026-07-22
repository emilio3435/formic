# Ant Hill Triage Workflow

## Goal

Turn a dashboard warning into a bounded, evidence-backed next action without interrupting healthy agents or pretending that analysis is execution.

## Decision path

1. **Detect** — the snapshot produces an issue with severity, summary, technical evidence, and affected agent IDs.
2. **Generate triage** — `POST /api/triage/generate` reads the current snapshot and returns a recommendation. This step does not mutate sessions or the queue.
3. **Classify**:
   - **Direct** — one agent and one focused unblock. The operator reviews the agent and sends the smallest targeted follow-up.
   - **Coordinated** — related agents or system evidence need one shared repair sequence.
   - **Investigation** — broad overlap across agents, programs, or technical evidence needs an isolated diagnostic lane.
4. **Review** — the UI shows the proposed outcome, affected scope, evidence, and ordered repair steps beside the warning.
5. **Queue investigation** — for complex cases, the operator explicitly creates one idempotent queue item with a directional investigation prompt.
6. **Launch explicitly** — `POST /api/triage/run` transitions one queued item to running and launches a fixed native `GPT-5.6 Luna · XHIGH` command in a read-only sandbox. Queueing alone never starts it.
7. **Observe** — the persisted item exposes queued, running, completed, or blocked state, its run ID/model/PID, and the bounded final result. A server restart converts an orphaned running item to blocked.
8. **Close with evidence** — completed means the investigation produced evidence; it does not imply that the original issue cleared.

## Investigation prompt contract

Every queued investigation states:

- `Goal:` the exact condition to resolve.
- `Success means:` observable reconciliation, repair, and verification outcomes.
- `Evidence:` the bounded facts that triggered the recommendation.
- `Recommended path:` deterministic diagnostic steps.
- `Stop when:` the issue clears in a fresh snapshot or one precise blocker is recorded.

## Safety and truth rules

- Generation and queueing require an exact same-origin loopback request.
- Queue persistence is serialized and idempotent by issue ID.
- Launch accepts only an issue ID. Model, arguments, prompt, cwd, sandbox, output path, concurrency, and ten-minute runtime limit are fixed server-side.
- Only one investigation runs at a time; repeat launch requests return the existing run instead of creating a duplicate.
- Ambiguous cmux identities remain quarantined while triage is generated.
- Recommendations describe proposed work; they never claim a fix ran.
- Unrelated sessions, worktrees, ports, and provider processes remain untouched.
- Queue consumers must preserve the same exact-target and fail-loud control rules as the dashboard.

## Stop when

The operator can identify the issue, understand its impact, see a concrete resolution path, queue it, and explicitly launch or inspect the bounded investigation without leaving the intervention card.

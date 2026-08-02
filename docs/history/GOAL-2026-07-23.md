# The Ant Hill

## Goal

Build a trustworthy, calm, glanceable local control hub for all active agent work without changing the live Mountain v2 service.

## Success means

- The new server runs independently on `127.0.0.1:4701`; Mountain v2 on port 4700 remains untouched.
- Codex, Claude, Cursor Agent, legacy OMP-history, and cmux collectors preserve source session IDs and exact working directories.
- Controls resolve an exact cmux workspace/surface target. Ambiguous or missing targets are disabled with a visible reason.
- Every control request reports the real command outcome; stderr and non-zero exits cannot appear as success.
- Mutating routes accept same-origin local requests only, validate structured actions, and leave arbitrary shell commands disabled.
- The UI exposes program, agent, task, model, elapsed time, token provenance, subagents, transcript tail, artifacts, git/test state, gates, and control health where available.
- Unknown provider billing remains visibly unknown; the dashboard never invents Cursor token totals or cost.
- Current usage is based on each working agent's latest request; cumulative session totals are labeled and kept out of the primary rollup.
- Cursor child agents are parent-linked and model-audited; Grok is compliant, reported non-Grok models are violations, and missing evidence is unverified.
- The light Hormiga Dormida visual language remains readable and calm at a glance without weakening warning or control states.
- The UI is keyboard-accessible and usable at mobile, tablet, and desktop widths.
- Unit and integration tests cover identity parsing, ambiguous routing, command failure propagation, request security, and snapshot behavior.
- A disposable cmux workspace proves safe focus/instruct/interrupt routing before any cutover is considered.
- Independent Sol and Grok reviews have no unresolved correctness or safety blocker.

## Stop when

The checks above pass with captured evidence, remaining unknowns are called out plainly, and the user has a local handoff. Do not commit, push, deploy, modify launchd, or cut over port 4700 without separate authorization.

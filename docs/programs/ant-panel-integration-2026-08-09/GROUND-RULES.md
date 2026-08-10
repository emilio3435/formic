# Ant Hill Panel Integration Ground Rules

Goal: Keep every implementation lane isolated, attributable, and cheap while one integration owner controls the release.

Success means:
- Each lane works in its named worktree and owns only its stated file fence.
- Every lane begins with a live lane report and ends with a local commit or precise blocker.
- The integration owner independently verifies every lane commit before landing it.
- Shared browser and service mutations occur only in the integration lane.

Stop when: The lane has produced its commit and evidence report, or has named the exact blocking dependency.

## Rules

1. Create `LANE-REPORT-<lane>.md` first with these headings, each initially `PENDING`: lane mission; named red claims; shipped files and fence; exact floor output; unverified or sandbox-refused checks.
2. Work only in the absolute worktree named by the kickoff.
3. Read the current implementation and immediate callers before editing.
4. Write the failing intent test first, then implement the minimum change that makes it pass.
5. Commit locally with explicit paths. Never push, deploy, restart services, switch branches, or amend history.
6. Keep scratch evidence in `.lane-evidence/`. Delete nothing.
7. Preserve `0472d7c` TL;DR behavior and the current 65/35 drawer contract.
8. Keep the OpenBurnBar cross-source assertion active; report external unavailability as a blocker.
9. Use `bun test`, not npm or another runner.
10. Stop at the kickoff fence. Send adjacent findings to the integration owner in the report.

Silent-failure traps:
- Inline `style` attributes are dropped by the production CSP.
- The stylesheet orphan test reads literal class names from source.
- A transcript owned by another agent must never render in the selected drawer.
- A refined task sidecar must retain the provider envelope as `rawTask` without inventing it when no source task exists.
- The shared gstack browser daemon has one machine-wide state; lane browser QA is integration-owned.

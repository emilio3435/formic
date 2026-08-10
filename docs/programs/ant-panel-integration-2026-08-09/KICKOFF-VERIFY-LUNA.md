# Verifier Luna Kickoff

Goal: Independently prove that the integrated panel release is internally consistent and ready for the guarded local deploy.

Success means:
- Review the integrated diff against `SPEC.md`, both original plans, and the ownership fences.
- Run the focused UI/foundation floor, typecheck, `git diff --check`, and the full repository gate.
- Inspect the live page at 1440px and 860px without mutating product source.
- Report exact failures, unavailable external evidence, and cost-sensitive follow-up recommendations.

Stop when: `LANE-REPORT-verify.md` contains exact command output and a READY or BLOCKED verdict tied to named evidence.

Use GPT-5.6 Luna in a fresh worktree at the integrated SHA. Keep product source read-only. Browser screenshots and the lane report are the only permitted writes. Never push, deploy, restart services, or launch subagents.

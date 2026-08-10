# Lane H - Formic browser QA and visual evidence

Goal: Verify the integrated Formic reskin in a real browser at both target widths and return decision-ready visual and interaction evidence.

Success means:
- The app runs from the exact integration head under test.
- Screenshots capture masthead plus TL;DR, readings, and a mixed-status agent board at 1440 and 860 widths.
- Reduced motion produces a static mark/LIVE treatment.
- Notifications, Settings, connection/LIVE state, filters, search, agent selection, inspector, and TL;DR paging work through visible interactions.
- Computed styles show Syne, Inter, and JetBrains Mono loaded locally with no CSP/font/console errors.
- New text/tint pairs have recorded WCAG contrast evidence.
- Every defect includes reproduction steps, screenshot path, selector, and severity; every unavailable check names the environment refusal.

Stop when: The exact integration head has a complete browser evidence report or a reproducible environment blocker after the allowed launch path is exhausted.

Read first:
1. `SPEC.md`, `GROUND-RULES.md`, and all implementation lane reports
2. The repository's browser/start instructions and exact current-head status

Own no production paths during the first pass. Write only ignored `LANE-REPORT-qa.md` and `.lane-evidence/formic/**` screenshots/logs. Return defects to the orchestrator for fenced repair lanes.

Use 1440x900 and 860x900 viewports. Verify screenshots at the exact served head; a healthy process started before that head is stale evidence.

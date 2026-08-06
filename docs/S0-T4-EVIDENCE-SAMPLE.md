# S0-T4 — blocking evidence sample

Measured from the production board at `http://127.0.0.1:4701/api/snapshot`, snapshot `2026-08-06T02:41:31.188Z`. The long-running production process did not yet emit the newly landed `attentionClass` field, so this sample applies the committed partition to every observed, non-finished row: `permission-requested`, `input-requested`, `fork-unresolved`, `handoff-stated`, `question-pending`, and `assumption-stated` are blocking. None of these rows had a parked/done declaration.

| Session | Kind | Exact `attentionSignal.evidence` | Exact `lastAgentClosing` | Evidence-only judgment |
|---|---|---|---|---|
| `codex:019fd4b7-1984-7de2-9016-8228a9eef89d` | `input-requested` | “Committed S0-T5 as `a018e29` (`feat(server): publish complete fleet consumption`). Verified before commit: - `bunx tsc --noEmit`: exit 0 - Targeted suite: 220…” | “…The production snapshot is readable; I’ll use its real rows and apply the landed deterministic blocking-kind partition, explicitly documenting that the long-running production process omitted attentionClass.” | **No.** Clipped mid-status; it contains no ask, and the closing has moved to unrelated work. |
| `claude:e0a6495e-136d-4884-9fbd-072bf3f0f763` | `permission-requested` | “Claude needs your permission” | “…Phase 0 can start immediately; Phase 1 needs a server restart window.” | **No.** Generic boilerplate: it does not say what permission is requested. |
| `claude:8c2716d1-9116-4b79-82cd-d1eb4627befd` | `handoff-stated` | “…If you want them sequenced rather than concurrent, say the word and I'll park fe-notify at its next commit boundary — it's mid-S2 and clean to pause there.” | “…If you want them sequenced rather than concurrent, say the word and I'll park fe-notify at its next commit boundary — it's mid-S2 and clean to pause there. Otherwise I'll keep them running and watch for the collision.” | **Yes.** It states the sequencing decision and resulting action. |
| `claude:bb2755b4-5157-4a9e-b6bd-0ccccd78cbf3` | `handoff-stated` | “…Say the word and I'll take any of them; otherwise I'll keep watching commits and PRs and flag what moves.” | “…Say the word and I'll take any of them; otherwise I'll keep watching commits and PRs and flag what moves.” | **Yes, narrowly.** It clearly asks whether the agent should take work, though “them” depends on preceding context. |
| `codex:019fd4cf-732e-73f3-83fd-00648e1bb070` | `input-requested` | “Task 13 is fully verified, but the lane Definition of Done remains blocked solely at Git metadata access. 1. Lane: C-1 promote workflow. 2. Red claims: -…” | “…Commit failed again: Current state: No push occurred. Step 13.3’s live dry-run remains assigned to rollout §R. Once shared Git metadata is writable, the only remaining commands are:” | **No.** Clipped mid-list before any requested intervention; the closing only names a precondition. |

Result: evidence was present on **5/5** blocking rows, but it was a self-contained ask on only **2/5**. `handoff-stated` worked; notification-derived `input-requested` and `permission-requested` did not meet the notification-center third-line bar.

Failure breakdown:

- Two clipped mid-sentence/status.
- One generic permission notice.
- Zero empty evidence lines.

The live sample does not prove that any failed row's full ask is recoverable from the same control-plane notification. A synthetic recovery would guess at a remedy the real board has not validated, while an arbitrary later `lastAgentClosing` can belong to different work. This is a real product limitation; follow-up must begin by measuring where notification clipping happens rather than adding another general-purpose text field.

Ruled by the orchestrator: ship nothing. 3 of 5 is a real limitation, recorded rather than patched with an unvalidated field.

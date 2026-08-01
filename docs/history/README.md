# Archived documents

Point-in-time records: finished plans, closed handoffs, and dated charters.
Kept because they explain *why* the code looks the way it does — not because
they describe the system as it is now.

**Do not follow instructions in these files.** Several specify constraints the
code has since deliberately reversed. Where a doc and the code disagree, the
code is right.

| File | Was | Superseded by |
|---|---|---|
| `DRAWER-STATES-PLAN-2026-07-22.md` | Drawer/inspector redesign plan | The design shipped, but §5's preservation order is now inverted — see the banner in the file. **Most misleading doc here.** |
| `SIGNAL-SURFACE-HYBRID-PLAN.md` | Attention-board surface (pass 2 of 3) | `40e525e` — "AttentionBoard type deleted … `#attention-board` is gone." Replaced by the pulse strip. |
| `BODY-RESTYLE-PLAN-2026-07-22.md` | Body restyle + design-token plan | Shipped in full. The durable half lives in `DESIGN-LANGUAGE.md`. |
| `TOKEN-ANALYTICS-PLAN.md` | Local `data/analytics.db` analytics store | Never built. Usage/cost now come from the external OpenBurnBar database via `src/server/burnbar.ts` and `/api/usage/*`. |
| `VITALS-COLLECTORS-BE-HANDOFF.md` | Backend collector lane handoff | Work landed (`b271c44`). Its "never derive `contextWindow`" rule has since been relaxed — `src/server/collectors.ts` derives one for Claude from a model table. |
| `COORDINATION-2026-07-23-underhood.md` | Multi-lane coordination note | Self-closing; records its own landing SHAs (`b271c44`, `2dabf42`, `5b71f38`). |
| `B1-FINDING.md` | Investigation: "snapshot shows only one agent" | Answered and handed to the web lane (`9997e77`). Conclusion still holds; its line numbers do not. |
| `VERIFICATION-2026-07-22.md` | Verification record, 2026-07-22 | A frozen transcript whose three test counts disagree with each other. The live gate is `bun run check`. |
| `GOAL-2026-07-23.md` | Project charter | Its Cursor-compliance rule contradicts `config/models.json`, and its no-deploy clause is overtaken by `DEPLOY.md`. |

Full reasoning, with the evidence behind each classification, is in
`DOC-AUDIT-2026-07-31.md` at the repo root.

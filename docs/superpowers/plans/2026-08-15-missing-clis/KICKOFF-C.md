# CLIS-C · Hermes (BE · Sol xhigh via Codex)

**Mission:** Hermes spend has a home. Cron is not an agent. Interactive sessions, if any, are rows.

**Consumes:** A merged. **Do not edit `src/shared/types.ts`.**

Spawn only after A is on this branch.

## First action

Write `LANE-REPORT-clis-c.md`. Characterize `~/.hermes/cron/` and one `~/.hermes/sessions/` file into `.lane-evidence/` before writing parsers. If the dirs are missing, fixture them and say so in §5.

## Tasks

1. Interactive collector for `~/.hermes/sessions/`. Characterize first — do not assume Claude JSONL. Real rows if files exist.
2. Cron spend sources from `~/.hermes/cron/` (`jobs.json`, output, ticker files). Shape from the spec:

```ts
interface SpendSource {
  id: string;            // "hermes:cron:cron_daily-watcher-001"
  provider: "hermes";
  kind: "cron";
  label: string;
  lastRunAt?: string;
  tokens?: TokenUsage;
  costUsd?: number;
}
```

Publish on the snapshot as `spendSources`. Usage tab lists them under cost. **No Focus. No Send. No Board row.**

3. `unmodelledProviders: string[]` on `sourceHealth` (or Usage summary): BurnBar provider names with no Formic collector. After Hermes is collected, it drops off this list. A billed name with no collector must appear even if cron parse fails.

4. Tests: `tests/hermes.test.ts` (interactive + cron fixture), collector-absence, a Usage render test that a spend source is not an agent row.

## Do not

- Close this lane by collecting only `sessions/`.
- Put cron on the Board.
- Map BurnBar `"Hermes"` onto Claude.
- Touch Grok files.

## Done when

Fixture cron job appears on Usage as Hermes, not as an agent. Missing `~/.hermes` is absent. Floor pasted in report §4.

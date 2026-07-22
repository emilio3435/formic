# Backend → Frontend contract (Terra / Sol done)

`bun run check`: TypeScript clean; **191 passed, 0 failed**.

## Always present on current server snapshots

```ts
snapshot.attentionBoard: {
  actNow: number;
  watch: number;
  inMotion: number;
  cleared: number;
  allClear: boolean; // true when actNow + watch + inMotion === 0
};

snapshot.triageSummaries?: Array<{
  issueId: string;
  state: "queued" | "running" | "completed" | "blocked";
}>;

issue.workState?: "needs_triage" | "watching" | "triaging" | "planned"
  | "queued" | "investigating" | "verifying" | "blocked" | "cleared";
issue.progress?: number;       // 0–100
issue.impactSummary?: string;  // plain language, no Affects(N)
```

## Semantics

- Open **errors** → `actNow` (and may also be `inMotion` if investigating/verifying).
- Advisories / detached blocked → `watch`.
- Active queue/investigation → `inMotion`.
- Recently resolved → `cleared`.
- If `attentionBoard` absent (old server): derive from issues + recentlyResolved + triageSummaries.

## FE should

Consume these fields; keep client fallback; rip ticker/Subdue; match `signal-surface-hybrid.html`.

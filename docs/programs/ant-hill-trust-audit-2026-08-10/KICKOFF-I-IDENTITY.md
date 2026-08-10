Goal: Determine whether current-head session identity, routing, and control authorization are truthful and fail-closed for each supported source population.

Success means:

- Claims `I-01` through `I-06` have evidence-backed verdicts.
- Home/Cursor, repository agents, and Prime sessions are traced independently from source identity through terminal target resolution.
- Control advertisement and write endpoints are checked against the same authorization evidence.
- Shared-cwd ambiguity, stable non-UUID Prime identifiers, stale snapshots, and unavailable cmux evidence are exercised without weakening safety.

Stop when: The lane report contains current-head evidence, exact commands and outputs, a prioritized finding list, and explicit unknowns for all identity/routing/control claims.

## Mission

Trace the full identity and routing chain on detached SHA `059cbbea670374a8778e20ef87f0582697efb42f`. Compare advertised Focus, Send, Interrupt, and broadcast capabilities with the server-side gates that actually dispatch them.

## Claims

- `I-01`: Each rendered agent identity preserves source/session identity without conflating provider, transcript, runtime, terminal, or cwd evidence.
- `I-02`: Exact target evidence wins in the documented order and every tier is visible in identity diagnostics.
- `I-03`: Shared-cwd and multi-source ambiguity authorizes no mutating control.
- `I-04`: Prime stable identifiers receive an evidence-based exact match or an explicit observed-only classification.
- `I-05`: Advertised control capability agrees with Focus, Send, Interrupt, and broadcast endpoint enforcement, including stale evidence.
- `I-06`: Probe failure preserves unknown/quarantine and cannot manufacture liveness or target identity.

## Inspection fence

Read `src/server/{identity,identity-bindings,targets,debug-identity,cursor,prime,cmux,cmux-hook-sessions,control,broadcast,http,process-liveness,process-witness,snapshot-agent,snapshot,types}.ts`, `src/shared/types.ts`, their immediate callers, and identity/control tests. Keep product and test source read-only in this phase.

## Evidence floor

Run the narrow identity/control suites you select and paste literal output. Inspect live loopback APIs only when already-running state can be read without mutation. Label time-specific live populations separately from deterministic fixture proof. Include `git status --short`, `git rev-parse HEAD`, and `git diff --check` in the report.

Write `LANE-REPORT-I.md` first with these headings, each initially `PENDING`: lane scope; named claims and first-red status; findings and proposed file fence; literal floor output; unverified or refused proof. Keep product source read-only, write scratch only under `.lane-evidence/`, never push or restart production, and delete nothing.

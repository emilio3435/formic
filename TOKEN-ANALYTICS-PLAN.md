# The Ant Hill — Token Analytics Center Plan

## Goal

Give an operator a trustworthy answer in under ten seconds: what is being used, by which model and program, whether calls are becoming larger or slower, and whether Cursor is following its Grok-only policy.

Success means every headline number has a visible unit, time range, provenance, coverage denominator, and drill-down to its contributing model invocations. Unknown data stays unknown. OMP is historical compatibility only and is excluded from every live/current calculation, KPI, chart, denominator, alert, and default filter.

## Truth contract

The current dashboard compresses three different concepts into “tokens.” The center must name them separately:

| Name | Definition | Presentation |
|---|---|---|
| **Processed** | Cumulative tokens processed during the selected range: uncached input + cached input + cache-write input + output. | Range KPI and time series. Millions can be correct across many calls. |
| **Latest call** | Tokens reported for the newest single model invocation. | Session row and drill-down; never added to the cumulative value again. |
| **Context capacity** | Provider-reported maximum context window. | Capacity/reference gauge only; never treated as usage. |

Canonical components are `uncachedInput`, `cachedInput`, `cacheWriteInput`, `output`, and optional `reasoningOutput` (a subset of output). Do not add reasoning twice.

- Codex: build invocation facts from `last_token_usage`; use `total_token_usage` only to reconcile the session counter. Codex `input_tokens` includes cached input, so normalize uncached input as `input - cached`.
- Claude: normalize each assistant invocation and deduplicate by `requestId`, falling back to `message.id`. Claude emits duplicate JSONL rows in current local evidence.
- Cursor: model observations are locally available, but authoritative token, latency, and cost totals are not. Those fields remain `unknown`, never zero or estimated.
- Cost: remain `unknown` unless observed. A later versioned rate-card result must be labeled `estimated API-equivalent`, not actual spend.
- “Request” in token analytics means a model invocation. User turns and tool-loop continuations are separate dimensions.

## MVP

### Data foundation

Persist normalized invocation facts in local SQLite at `data/analytics.db`; dashboard snapshots cannot support reliable history.

```text
analytics_events
  id, provider, source_session_id, event_key, observed_at
  model, program_id, agent_role
  event_kind            model_invocation | user_turn | turn_end
  request_kind          user | tool_loop | compaction | unknown
  prompt_chars, response_chars
  uncached_input_tokens, cached_input_tokens, cache_write_input_tokens
  output_tokens, reasoning_output_tokens, processed_tokens
  context_window_tokens
  wall_ms, latency_provenance
  token_provenance
  cost_usd, cost_provenance, pricing_version

analytics_sessions
  provider, source_session_id, program_id, started_at, ended_at, latest_model

cursor_model_observations
  conversation_id, observed_at, model, compliance, policy_version

analytics_source_state
  source_key, provider, source_path, byte_offset, size, mtime_ms
```

Require unique `(provider, source_session_id, event_key)` ingestion. Re-reading an unchanged transcript must produce zero new facts. Store UTC; localize labels in the browser. Store counts and dimensions, not prompt or response bodies. Create the database with user-only permissions and a 30-day raw-event retention default.

Cursor compliance uses a versioned exact allowlist of approved Grok model identifiers. A missing model is `unknown`, not compliant. Historical tracking rows may establish a model-policy observation but never a token-bearing invocation.

### API

- `GET /api/analytics/summary?from=&to=&program=&provider=&model=`
- `GET /api/analytics/series?from=&to=&bucket=&groupBy=model`
- `GET /api/analytics/distribution?from=&to=&metric=processedTokens`
- `GET /api/analytics/invocations?from=&to=&limit=&cursor=`
- `GET /api/analytics/cursor-policy?from=&to=&compliance=`
- `GET /api/analytics/capabilities`

Every response includes `rangeStart`, `rangeEnd`, `completeFrom`, eligible/reporting session counts, provider-level token/latency/cost provenance, and warnings. A range older than retained or backfilled evidence is visibly `partial since …`.

### High-acuity Ant Hill UI

Add **Analytics** beside the operational control room. Use the Ant Hill light, quiet, Hormiga Dormida visual language, but optimize for scan speed rather than decorative ant, tunnel, or hive graphics.

1. Filter bar: 1h, 24h, 7d, 30d, custom; program, provider, model, provenance.
2. KPI strip: Processed, Generated, Invocations, Median per call, p95 per call, p95 turn wall time, Coverage.
3. Stacked area chart: processed tokens over time, grouped by model by default.
4. Model donut with an explicit toggle: Processed, Output, Invocations, Estimated cost. Unknown coverage appears beside the chart, not as fabricated usage.
5. Distribution strip: median visually primary, then average, p95, and maximum.
6. Request profile: invocation type plus prompt/response character distributions. Characters and tokens remain separate units.
7. Cursor policy panel: allowed Grok, unexpected non-Grok, and unknown; recent violations show model, session, and observation time.
8. Paginated invocation table opened by any chart selection.
9. Persistent provenance footer: collection freshness, parser version, coverage, and partial-range warnings.

Use direct labels, stable colors, restrained motion, keyboard focus, and readable values at 390px, 768px, and 1440px. Prefer one high-signal comparison over dense chart chrome.

## V2

- Instrument monotonic request start/end where provider hooks permit it; until then label timestamp-derived duration `turn wall time`, not model latency.
- Deterministically classify initial user calls, follow-ups, tool loops, compactions, and unknowns from event metadata—no model classifier.
- Add versioned provider/cache price tables with effective dates and API-equivalent estimates.
- Add parent/child swarm contribution, cache efficiency, output/input ratio, model/program comparisons, anomaly rules, and CSV/JSON export.
- Compact retained raw facts into hourly/daily aggregates for 90-day views.
- Add explicit retention and confirmed delete-history controls.

## Test and release gates

- Claude rows sharing a request or message ID count exactly once.
- Codex invocation facts reconcile to `last_token_usage`; the final cumulative counter is never used as a single-call value.
- Processed, Latest call, and Context capacity never share an ambiguous label or unit.
- Cursor unknown-token sessions affect coverage denominators but never token or cost numerators.
- Missing Cursor model is unknown; a non-allowlisted exact model creates a policy violation.
- OMP contributes zero live/current facts, totals, coverage, alerts, and chart series.
- Re-ingesting unchanged files creates zero duplicate events.
- Median, average, p95, and time buckets match hand-calculated fixtures, including UTC/DST range boundaries.
- Cost is null without provenance and a pricing version.
- No prompt or response body appears in SQLite.
- A 100,000-event summary query meets the agreed local target (suggested: under 200 ms).
- Partial history, empty data, and source errors are visible and cannot resemble complete coverage.
- Keyboard and responsive QA pass at 390px, 768px, and 1440px without clipped charts, hidden units, or inaccessible drill-downs.

## Stop when

MVP is complete when an operator can trace every KPI and chart segment to normalized invocation facts, distinguish cumulative work from one call and context capacity, identify confirmed and unknown Cursor policy state, and see coverage before interpreting any number.

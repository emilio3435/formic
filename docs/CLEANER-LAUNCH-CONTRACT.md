# Cleaner launch contract

`POST /api/cleanup/launch` launches one human-gated Cleaner lane. It is a spawn route only: there is no cleanup-confirm HTTP route and no repository removal command is reachable from the server route.

The request has no body. It requires an exact same-origin loopback `Origin` header, like the other mutating board routes.

## Success and client binding

HTTP `200` has this exact shape:

```json
{
  "ok": true,
  "sessionId": "79592379-c8fb-4ea4-800c-57c22d3c435e"
}
```

The route returns only after a fresh server snapshot contains a Cursor agent whose `sourceSessionId` equals `sessionId`. The client binds by that exact pair (`provider === "cursor"` and `sourceSessionId === sessionId`), or equivalently by `agent.id === "cursor:" + sessionId`. It must not bind by the display name: the authored name is `Cleaner`, but names are presentation rather than identity.

Concurrent launch requests share one in-flight spawn and receive the same success response. Once that launch has completed, another request while its session is still active receives `CLEANER_ALREADY_RUNNING`, below, with the existing id. A session that disappeared from an incomplete snapshot is not treated as ended; only an observed `activity: "ended"` permits a new Cleaner.

## Failures the client must render

Every failure is JSON with `ok: false` and `error: { code, message }`. The chip should render the message and leave the spinner state.

| HTTP | Code | Meaning |
|---:|---|---|
| 405 | `METHOD_NOT_ALLOWED` | The request was not `POST`. |
| 403 | `ORIGIN_REJECTED` | The request was not exact same-origin loopback. |
| 503 | `CLEANER_UNAVAILABLE` | This server was started without a Cleaner launcher. |
| 503 | `CLEANER_SESSION_CREATE_FAILED` | Cursor could not reserve the session. No lane was launched. |
| 503 | `CLEANER_SESSION_ID_INVALID` | Cursor did not return one bindable UUID. No cmux workspace was requested. |
| 503 | `CLEANER_CMUX_UNREACHABLE` | cmux was missing, timed out, or its socket could not be reached. |
| 503 | `CLEANER_LAUNCH_FAILED` | cmux or another spawn step refused the workspace for a non-transport reason. |
| 503 | `CLEANER_SESSION_NOT_OBSERVED` | A workspace was requested, but repeated fresh snapshots could not resolve its session id. A retry rechecks the same id and cannot spawn a duplicate. |
| 409 | `CLEANER_ALREADY_RUNNING` | A Cleaner is already active. This response also carries its `sessionId`. |

The already-running response is:

```json
{
  "ok": false,
  "sessionId": "79592379-c8fb-4ea4-800c-57c22d3c435e",
  "error": {
    "code": "CLEANER_ALREADY_RUNNING",
    "message": "Cleaner session 79592379-c8fb-4ea4-800c-57c22d3c435e is already running; bind to that session instead of launching another lane."
  }
}
```

Unexpected launcher exceptions are reported as `503 CLEANER_LAUNCH_FAILED`; they are never converted into success or a silent no-op.

## What is spawned

- Provider/model: Cursor Agent, `grok-4.5` (Grok 4.5 High Fast).
- Workspace: a background cmux workspace named `Cleaner`, rooted at this repository.
- Identity: a preassigned resumable Cursor UUID, launched through `scripts/anthill-cursor-agent`, which writes the ordinary Anthill hook binding. The existing session-name store authors `Cleaner` for that exact agent id.
- Skill/tool: the prompt invokes `/cleanup` and scopes the run to `scripts/anthill-cleanup-sweep.ts`. The agent proposes first, reports every refusal and per-item rollback SHA, asks the operator in its ordinary session, and enters the sweep's guarded confirmation only after approval.
- Progress: the existing Cursor transcript, hook lifecycle, attention detection, and snapshot collector are the sole progress channel. No Cleaner telemetry store exists.

The Cleaner runs in Cursor's normal interactive approval mode. The older propose-only sweep used Cursor's force flag; R2-prime moved approval into the visible agent lane, and the route source fence now deliberately excludes that flag along with direct destructive commands.

## Non-obvious measured facts

Cursor Agent discovers skills under `~/.claude/skills`, so the installed `/cleanup` skill is available to this Cursor lane. `cursor-agent create-chat` returns a UUID before a collectible session row necessarily exists; resuming that UUID creates the ordinary session evidence. That is why the route waits for snapshot resolution rather than treating a syntactically valid UUID as proof that a bindable lane exists.

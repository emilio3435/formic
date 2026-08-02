# Security boundary

Ant Hill can focus the operator's cmux terminals, type text into them, and press
Enter. If the selected terminal is a shell, that text can be a shell command.
It can also send Escape to interrupt a terminal. Every security decision below
starts with that authority.

## Accepted boundary

**Loopback plus exact Origin defends against browser-based attacks; any process
running as the operator is trusted.**

This is a deliberate same-UID trust decision. Ant Hill does not authenticate
one local process to another. There is no bearer token, pairing step, or
separate-user broker.

## What is defended today

- **App-wide loopback Host gate.** Every route rejects a request whose URL host
  is not `localhost`, `127.0.0.1`, or IPv6 loopback. The production server is
  also bound to `127.0.0.1`. These checks stop ordinary remote access, DNS
  rebinding through a non-loopback Host, and accidental use through another
  hostname. They do not identify the local process making the request.

- **Exact same-origin checks on mutations.** Control, broadcast, settings,
  attention, triage, recollect, and other state-changing routes require the
  browser-supplied `Origin` to equal the loopback request origin. This stops a
  hostile website opened in the operator's browser from issuing changes to Ant
  Hill. A local process can construct the same header, so this is browser CSRF
  protection, not local caller authentication.

- **Read-only GET exception.** Read-only GET endpoints that omit an `Origin`
  requirement still pass through the app-wide loopback Host gate. Browsers do
  not reliably send `Origin` on same-origin GETs, and page JavaScript cannot set
  that forbidden header itself. Some sensitive read endpoints are stricter and
  additionally require an exact same-origin `Origin`.

- **Fresh target evidence for single-agent control.** Before `focus`,
  `instruct`, or `interrupt` through `/api/control`, Ant Hill rejects a snapshot
  older than 30 seconds. This prevents old routing evidence from targeting a
  terminal after the observed state has gone stale. `archive` is exempt because
  it changes Ant Hill's local data, not cmux.

  `/api/broadcast` enforces the same 30-second check: it rejects a stale
  snapshot with `STALE_SNAPSHOT` before dispatching any `instruct` action
  (`src/server/broadcast.ts`). The gate is still duplicated in the two routes
  rather than centralized in the shared execution path, so a third caller
  would not inherit it.

- **Redacted identity diagnostics.** The debug identity endpoint omits raw
  process command lines. This reduces accidental disclosure of arguments and
  credentials in diagnostic output. It does not make the endpoint private from
  other processes running as the operator.

- **Fail-closed terminal identity.** Ant Hill requires observed routing evidence
  before enabling a terminal control. Missing, conflicting, stale, child-only,
  or ambiguous evidence disables control instead of inventing a binding.
  Unique-cwd fallback is allowed only when one active source and one unclaimed,
  ready cmux surface match; absence by itself never becomes a target.

- **Structured control actions.** The terminal-control API accepts only
  `focus`, `instruct`, `interrupt`, and local `archive`. Callers cannot provide
  an executable, argv array, cwd, arbitrary key, raw cmux RPC, or shell-spawn
  request. `instruct` rejects CR/LF and oversized text. This limits the API
  shape, but an allowed one-line instruction is still typed into the terminal
  and submitted.

## What is not defended

Any process running as the operator's macOS user can drive the control plane.
It can call the loopback HTTP routes with an allowed Host and forged Origin.
It may also be able to invoke the operator-owned cmux socket directly.

A bearer token stored for this same user is not a strong boundary against that
user's processes: they share access to the token's files and runtime
environment. A Unix-domain socket does not solve this either. On macOS,
`getpeereid(3)` or `getsockopt(..., LOCAL_PEERCRED, ...)` reports the peer's OS
user; it cannot distinguish two processes with the same UID.

The installed cmux 0.64.20 closes off the proposed separate-user broker in the
other direction: in its current password mode it rejects clients whose UID
differs from cmux's UID. Running the broker as another user or root therefore
cannot control this cmux, while changing cmux to `allowAll` would remove the
boundary rather than strengthen it.

Ant Hill consequently does not defend against a compromised Claude, Codex,
Cursor, shell script, editor extension, or other process if it runs as the
operator. It also does not defend against root, Accessibility-authorized UI
automation, or a compromised cmux application.

## When this decision must be revisited

| Change | Required security work before use |
|---|---|
| Expose port 4701 through a tunnel, Tailscale, port-forward, or reverse proxy | Do not expose the current routes. Add an authenticated and encrypted remote boundary, explicit authorization for control actions, CSRF protection appropriate to the new origin, credential rotation, and remote-threat tests. |
| Bind the server beyond loopback | Stop deployment until real network authentication and authorization exist. Host and Origin checks are not substitutes. |
| Run on a shared or multi-user Mac | Treat loopback as reachable by other local accounts. Isolate the control plane and agents by OS identity, or add a proven per-user authentication design supported by cmux. |
| Give another person a login on this Mac | Reclassify the machine as multi-user before creating the login. Disable terminal control or implement the multi-user boundary first. |
| cmux gains a restrictive cross-UID authentication mode | Reopen the separate-user broker design, verify the exact cmux release, and test peer rejection and the browser bridge. Do not enable `allowAll`. |

## Dogfooding on another Mac

The other Mac inherits the same boundary; installing Ant Hill does not create
local caller authentication. Keep it bound to loopback, do not tunnel the port,
and understand that every process run as that Mac's operator account is trusted
to focus and type into cmux terminals. If the Mac is shared or has additional
interactive users, do not enable terminal control under this decision.

The measurements, rejected OS-separation architecture, migration costs, and
pinned cmux evidence are in
[AUTH-OS-SEPARATION-DESIGN.md](AUTH-OS-SEPARATION-DESIGN.md).

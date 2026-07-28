**Verdict — NO for the stated threat and the operator's current setup.** A Unix-socket peer check cannot distinguish the legitimate dashboard from a hostile process when both run as `emilionunezgarcia` (UID 501), and the installed cmux 0.64.20 explicitly rejects clients with a different UID in its current password mode, so a separate-user or root broker cannot control it. The only immediately feasible OS boundary is to move every Claude, Codex, and Cursor agent process to a separate non-admin macOS account while leaving cmux and its controller with the operator; that protects against those moved agents, not against every hostile UID-501 process. It is a daily-workflow migration: worktrees and generated-file ownership, SSH and API keychains, cmux launches and hooks, provider CLI credentials, `launchd` domains, collector homes, scripts, and absolute paths all change. The operator has not agreed to that consequence, so the selected option 3 should not be built as currently summarized.

# OS-enforced separation for the Ant Hill control plane

Status: design spike / decision document

Measured: 2026-07-28 on the operator's Mac, read-only

Decision requested: reject the literal option 3; decide separately whether to authorize a one-agent, separate-user pilot

## Feasibility gate

This section answers the three questions that must be resolved before an architecture can be proposed.

### 1. What Unix-socket peer credentials buy

On macOS, an accepted `AF_UNIX` stream socket can retrieve the connecting process's effective UID and GID with `getpeereid(3)`. The lower-level equivalent used by cmux is:

```c
struct xucred credential = {0};
socklen_t length = sizeof(credential);

getsockopt(client_fd, SOL_LOCAL, LOCAL_PEERCRED, &credential, &length);
```

An implementation must require a successful call, the expected structure length, `credential.cr_version == XUCRED_VERSION`, and an allowed `credential.cr_uid`. It can retrieve the peer PID separately with `LOCAL_PEERPID`. Failure must reject the connection. The kernel captures these credentials at connection establishment; a caller cannot choose a different UID in an HTTP header or token. This is a useful boundary between *different OS users*. See Apple's [`getpeereid(3)` manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/getpeereid.3.html).

It buys no caller authentication between two processes running as UID 501. If the broker accepts UID 501 so that the Bun dashboard can connect, every hostile UID-501 agent or process passes the same check. Socket file mode `0600` has the same limitation. PID allowlisting is not an authentication scheme: PIDs are reused, parentage changes across launchers, and a same-UID attacker can launch the allowed executable or bypass the dashboard and call cmux directly.

Peer credentials therefore answer “which Unix account connected?”, not “is this the legitimate Ant Hill dashboard?”

### 2. Whether the agents and cmux must move

The agents must move to a different OS user for account separation to protect against an agent compromise. cmux does **not** need to move for that narrower architecture; it can remain in the operator's `gui/501` session with the trusted controller. Moving the agents is still a full workflow change because their repositories, session stores, credentials, shells, provider installations, and generated files then belong to the new account.

The literal selected architecture—broker under a separate user or root, cmux under UID 501—does not work with the installed cmux. Its pinned 0.64.20 source obtains `LOCAL_PEERCRED` and rejects a different `cr_uid` in both automation and password modes. Its socket is also `0600`. Root is UID 0 and is rejected too; root does not magically satisfy a same-UID comparison. `allowAll` changes the socket to `0666` and accepts other UIDs, but deliberately removes the boundary option 3 is supposed to create.

Moving cmux itself to a separate account would mean that account must own the graphical cmux application and its terminal sessions. The operator would need to use that account's graphical login session, or maintain a cross-login UI bridge. A `LaunchDaemon` cannot simply take ownership of a GUI application in `gui/501`. This is a different desktop operating model, not an installer detail.

### 3. Consequence for the selected option

The one-line version of option 3 was incomplete. A separate broker identity alone provides no usable benefit here:

- If the broker accepts the UID-501 dashboard, it also accepts hostile UID-501 callers.
- If the broker runs under another UID, current cmux rejects its commands.
- If cmux is changed to accept all users, the OS boundary is weakened rather than strengthened.
- If the agents remain UID 501, they can bypass Ant Hill and talk to the UID-501 cmux socket directly using the same local capability material.

There are two honest ways forward:

1. Narrow the threat to agent processes and move all agents to an untrusted account, keeping the trusted UI, dashboard/controller, and cmux together under the operator account.
2. Preserve the original “any UID-501 process” threat and change cmux plus the UI path so cmux accepts only a strongly identified native controller—not arbitrary UID-501 clients—and the controller requires operator presence or a code-identity-bound client. That requires upstream cmux work or a maintained fork and replacement of the ordinary browser-to-loopback trust path.

Neither is the separate-user broker described in option 3. The first is proposed below only as a conditional pilot; the second is not recommended for this local dashboard without a larger product decision.

## Measured baseline

No service, plist, socket, account, or source file was changed during this investigation.

### How Ant Hill runs

The live `ai.imaginethat.anthill` job is a per-user LaunchAgent:

| Fact | Measured value |
|---|---|
| launchd domain | `gui/501` |
| process owner | `emilionunezgarcia`, UID 501 |
| executable | `/Users/emilionunezgarcia/.bun/bin/bun` |
| entry point | `/Users/emilionunezgarcia/Developer/the-mountain-main/src/server/index.ts` |
| working directory | `/Users/emilionunezgarcia/Developer/the-mountain-main` |
| bind | IPv4 `127.0.0.1:4701` |
| plist | `~/Library/LaunchAgents/ai.imaginethat.anthill.plist` |
| declared environment | `CMUX_SOCKET_CAPABILITY`, `MOUNTAIN_PORT`, and `PATH` |

`launchctl print gui/501/ai.imaginethat.anthill` reported the job active and running. `lsof` confirmed the loopback listener. A normal request to `/` returned 200 and a forged non-loopback `Host` returned 403. The service was not restarted.

### How cmux is scoped

The installed application and its live process are owned by UID 501. The active socket is:

```text
/Users/emilionunezgarcia/.local/state/cmux/cmux-501.sock
```

The socket is owned by UID 501 with mode `0600`; its parent directory is mode `0700`. The active cmux configuration uses `automation.socketControlMode = "password"`. The live Ant Hill server reads the password from `data/cmux-socket.env` and passes it to the cmux CLI through inherited environment, not argv.

The installed binary identifies itself as `cmux 0.64.20 (100) [14e3400b9]`. Inspection of that exact source revision shows:

- [`SocketTransport+Peer.swift`](https://github.com/manaflow-ai/cmux/blob/14e3400b95daedd652d0b6f395d0777c41e39eef/Packages/macOS/CmuxControlSocket/Sources/CmuxControlSocket/Transport/SocketTransport%2BPeer.swift) calls `getsockopt(..., SOL_LOCAL, LOCAL_PEERCRED, ...)` and compares `cr_uid` with `getuid()`.
- [`SocketClientAuthorization.swift`](https://github.com/manaflow-ai/cmux/blob/14e3400b95daedd652d0b6f395d0777c41e39eef/Packages/macOS/CmuxControlSocket/Sources/CmuxControlSocket/Transport/SocketClientAuthorization.swift) requires the same UID in automation and password modes.
- [`SocketControlMode+SocketControl.swift`](https://github.com/manaflow-ai/cmux/blob/14e3400b95daedd652d0b6f395d0777c41e39eef/Packages/macOS/CmuxSettings/Sources/CmuxSettings/SocketControl/SocketControlMode%2BSocketControl.swift) uses `0600` for those modes and `0666` for `allowAll`.

A read-only `cmux --json tree --all` succeeded as UID 501. A runtime probe as root could not be completed because passwordless `sudo` is not enabled; the rejection of UID 0 is therefore source-proven for the exact installed revision, not runtime-proven.

### What Bun and the browser can do

Bun 1.3.14 can [serve HTTP over a Unix-domain socket](https://bun.com/docs/runtime/http/server#unix-domain-sockets), and Bun's `fetch` supports a Unix-socket path. Its documented JavaScript server/socket API does not expose the accepted native file descriptor or peer credentials; `Server.requestIP()` returns `null` for a Unix socket. The installed `bun-types` likewise exposes no `getpeereid`, `LOCAL_PEERCRED`, or accepted-socket descriptor API.

Consequences:

- A Bun Unix-socket server alone cannot perform the required kernel credential check through a supported API.
- A real peer-checking broker needs a small native Swift/C listener, XPC service, or a Bun native extension. A native Swift listener is the smallest maintainable choice.
- A normal browser cannot open an arbitrary Unix-domain socket. The HTTP server remains a bridge, or the product becomes a signed native application/WebView.
- Loopback TCP provides no OS-user identity. A browser bridge needs an explicit credential or per-session approval even after agent accounts are separated.

## Threat model

### Security objective

The audit objective is to prevent an untrusted local agent process from causing cmux to focus a terminal, inject text, submit it, or send an interrupt without the operator's authorization.

There are two materially different threat statements:

| Threat | Can the proposed account split defend it? |
|---|---|
| Claude/Codex/Cursor processes moved to a distinct, non-admin user | Yes, if they cannot read the operator's secrets or access cmux/controller sockets |
| Any hostile process still running as `emilionunezgarcia` | No; it shares the same UID and can call current cmux directly |

This design does not claim the first result is the second.

### Defended after a correct separate-agent-user migration

An untrusted agent account cannot:

- open the operator-owned `0600` cmux or controller socket;
- read the operator's cmux password, Ant Hill browser credential, browser profile, or controller state;
- pass a `LOCAL_PEERCRED` allowlist that permits only the operator account;
- call a mutating loopback route without a separate capability it cannot read;
- convert an old terminal mapping into a command after the controller-side 30-second lease expires.

This assumes the agent account is non-admin, receives no broad sudo rule, and is not granted ACL access to the operator's secrets.

### Not defended

The design does not defend against:

- malicious or compromised processes that still run as UID 501;
- root, an administrator who can become either account, or a compromised kernel;
- UI automation with Accessibility permission that can drive cmux directly;
- a compromised cmux binary, controller binary, browser profile, provider CLI, or dependency running in the trusted account;
- malicious repository content changing files the operator later executes;
- an agent exfiltrating credentials intentionally provisioned to its own account;
- an operator deliberately approving an instruction;
- denial of service, terminal-content observation, or ordinary repository sabotage;
- another local account if it is accidentally given group/ACL access to the control socket or token.

### What the shipped state already covers

The current server has useful defense in depth:

- `src/server/app.ts` applies a loopback `Host` gate to every route.
- Mutating routes enforce POST, JSON shape/size, and exact loopback `Origin`, which blocks ordinary cross-site browser requests.
- `src/server/http.ts` rejects single-agent cmux actions when routing evidence is older than 30 seconds.
- Instructions reject embedded CR/LF and have an 8,192-byte limit.
- The debug identity route redacts process command lines.

Those checks do not authenticate a local process. A same-UID process can construct an allowed `Origin`, call loopback directly, read same-UID files, or bypass Ant Hill and invoke cmux.

One current gap matters to the broker design: `/api/broadcast` calls `executeControl` for each target but does not apply the single-control route's 30-second freshness gate. Freshness and target resolution must be enforced inside the privileged controller so every caller and batch path receives the same policy.

## Architecture

### Rejected literal topology

```text
browser (UID 501)
    |
    | HTTP on 127.0.0.1
    v
dashboard (UID 501)
    |
    | Unix socket
    v
broker (UID B or root)
    |
    | cmux socket
    v
cmux.app (UID 501)
```

This topology fails twice. The browser-to-dashboard hop is not OS-authenticated, and current cmux rejects the broker's different UID. Running the broker as UID 501 fixes connectivity but removes the claimed separation.

### Conditional topology that works with current cmux

The smallest deployable OS boundary keeps the entire trusted control side under UID 501 and moves only the risky agent processes:

```text
TRUSTED: operator UID 501
  browser --paired HTTP--> Ant Hill controller --owner-only socket--> cmux.app
                                      |
                                      +-- observations / short-lived surface leases

UNTRUSTED: agent UID A, non-admin
  Claude / Codex / Cursor -- shared repository data only
  no cmux socket, no controller token, no UID-501 home or browser-profile access
```

The controller may initially remain in the existing Bun service. A native owner-only broker under UID 501 does not improve the same-UID boundary, so adding it before cmux supports a stronger client identity is complexity without security value. The useful boundary is UID A versus UID 501.

If the product later needs a native policy service, implement a small Swift LaunchAgent in `gui/501`. It should:

1. own a socket inside a mode-`0700` UID-501 directory;
2. set the socket mode to `0600`;
3. inspect every accepted stream with `LOCAL_PEERCRED`;
4. reject any UID other than 501 and fail closed on credential errors;
5. own the cmux password and all terminal observations;
6. expose only the methods below, never raw cmux RPC;
7. record structured local audit events without terminal text or credentials.

That broker excludes UID A but still does not exclude hostile UID-501 clients. It should be described as an operator-side policy service, not as protection from same-UID malware.

### Exact privileged API surface

The current product uses only these cmux operations:

| Product purpose | Current cmux operation | Repository evidence |
|---|---|---|
| discover terminal surfaces and metadata | `rpc debug.terminals {}` | `src/server/cmux.ts:250-269` |
| collect attention state | `list-notifications --json` | `src/server/cmux.ts:295-318` |
| attribute processes when a surface lacks a TTY | `rpc system.top {"all_windows":true,"include_processes":true}` | `src/server/identity.ts:12-15,237-250` |
| focus an agent terminal | `rpc surface.focus {"surface_id":...}` | `src/server/control.ts:103-106` |
| enter an instruction | `rpc surface.send_text {"surface_id":...,"text":...}` followed by `rpc surface.send_key {"surface_id":...,"key":"Enter"}` | `src/server/control.ts:109-142` |
| interrupt | `rpc surface.send_key {"surface_id":...,"key":"Escape"}` | `src/server/control.ts:107-108` |

`archive` is an Ant Hill data-store operation and must remain outside the broker. Attention acknowledgment, snooze, dismiss, recollect, and triage state are also not cmux privileges. Broadcast is repeated `instruct`, not a distinct primitive.

Two operational scripts use additional cmux privileges outside the running product: `anthill-start.sh` can invoke `new-workspace` with a cwd and command to launch the server, and `setup-cmux-password.ts` invokes `reload-config` while configuring password mode. Neither belongs in the browser-facing broker API. The first must be replaced or retained as a trusted operator-only startup action; the second is installation/configuration authority and should run only during explicit setup. The setup script currently supplies its generated password through a `--password` argument, unlike the live server's inherited environment, so it must also be reviewed before it is reused in a hardened installer.

The current `BunCommandRunner` launches a direct argv array with `Bun.spawn`, not a shell string (`src/server/command.ts:3-56`). That is the right execution shape, but a broker must not expose this generic runner to callers. It should construct the fixed cmux argv internally from the narrow methods below.

The broker/controller API should be narrower than cmux:

| Method | Input | Policy |
|---|---|---|
| `observe()` | none | Returns sanitized terminal/notification/process observations plus a generation and collection time |
| `focus(lease)` | opaque surface lease | Lease was issued by the controller, names one current surface, and is at most 30 seconds old |
| `instruct(lease, text)` | opaque surface lease; UTF-8 text | Reject empty text, CR/LF, and more than 8,192 bytes; atomically perform one `send_text` then exactly one Enter |
| `interrupt(lease)` | opaque surface lease | Sends only the fixed `Escape` key |
| `health()` | none | Version, readiness, and cmux reachability only; no secrets or terminal contents |

There must be no `rawRpc`, arbitrary surface ID, arbitrary key, arbitrary executable, shell command, or caller-selected cmux socket path. The controller, not the browser, resolves agent IDs to surfaces. A batch instruction validates all leases under the same policy before invoking `instruct` per target.

The existing implementation retries Enter after an error/timeout. The broker must not repeat an action after an unknown delivery result; it should return an explicit indeterminate-delivery error for operator reconciliation. This avoids turning a transport timeout into a duplicate submission.

### Browser bridge and caller authentication

The browser cannot use the Unix socket. For the conditional separate-agent-user architecture:

1. Keep the HTTP listener on `127.0.0.1`.
2. Require a 256-bit random capability on every mutating route, including control, broadcast, settings changes, triage execution, and any future broker method.
3. Pair the browser by an explicit operator action; never serve the capability from an unauthenticated local GET.
4. Store the capability only in the UID-501 browser profile and a UID-501 `0600` file or Keychain item.
5. Rotate it on suspected exposure and make previews use a different, non-production capability.
6. Retain the Host, Origin, method, size, and freshness checks.

This token becomes meaningful against UID A because that account cannot read it. It remains defense in depth, not a strong boundary against UID 501.

For the original any-UID-501 threat, the browser bridge is insufficient. A viable design would require a signed native UI or native bridge, validation of the peer's audit token/code-signing requirement, operator-presence authorization for sensitive actions, and a modified cmux that refuses every client except that controller. That is a new product architecture and an upstream/fork dependency, not a small broker installation.

### Identity assignment

| Component | Current | Conditional pilot |
|---|---|---|
| browser and Ant Hill UI | UID 501 | UID 501 |
| Ant Hill HTTP/controller | UID 501, `gui/501` LaunchAgent | UID 501, with paired mutating capability |
| cmux.app and socket | UID 501, graphical login | unchanged |
| native policy broker | absent | defer; if added, UID 501 LaunchAgent |
| Claude/Codex/Cursor processes | UID 501 | non-admin agent UID A |
| repositories/worktrees | UID 501 paths | separate clones/worktrees in a deliberately shared root |
| provider/SSH/Git credentials | UID 501 home/Keychain | separate least-privilege credentials in UID A home/Keychain |

## Migration

This is the migration for the conditional separate-agent-user architecture. Do not start it merely by approving a broker implementation.

### Ordered manual steps

1. **Approve the narrower threat and operating model.** Record that moved agent processes are untrusted UID A, while every remaining UID-501 process is trusted. If “any UID-501 process” remains the requirement, stop; this migration does not meet it.

2. **Inventory providers and repository access.** List every Claude, Codex, Cursor, GitHub, SSH, API, package-registry, cloud, and signing credential agents actually need. Decide whether provider terms or seat licensing permit a second local account. Do not copy the operator's private keys or browser profile.

3. **Create one non-admin pilot account.** Log in graphically once so macOS creates its home, Keychain, and `gui/<agent-uid>` domain. Give it no admin membership, broad sudo rule, Accessibility permission, Full Disk Access, or ACL to the operator's home. A background-only account is insufficient if a provider or launcher depends on a GUI login Keychain.

4. **Create a shared repository boundary.** Use a new explicit root such as `/Users/Shared/AntHillAgent`, owned by a dedicated group with setgid/default ACL behavior tested on this macOS version. Prefer fresh clones and fresh worktrees owned by UID A. Do not point UID-A worktrees at UID-501 linked-worktree metadata: existing `.git` files refer to common git directories and absolute paths owned by UID 501. Configure Git `safe.directory` only for exact intended roots.

5. **Install the agent toolchain as UID A.** Install the approved Bun/runtime and Claude, Codex, Cursor, Git, GitHub, package, and provider CLIs through their supported update paths. Duplicate installs and caches are intentional; do not grant access to the operator's home to save setup time.

6. **Provision least-privilege credentials as UID A.** Create separate SSH keys, GitHub/provider tokens, API keys, and Keychain items with the minimum repository and service scopes. Register them independently. The operator must now rotate and revoke credentials per account and per machine.

7. **Reconfigure Ant Hill collection.** Current collectors derive Claude, Codex, Cursor, and OMP session paths from `homedir()` and UID-501 application-support paths. Add explicit, allowlisted UID-A roots or a one-way sanitized status exporter. Do not make the UID-A home generally readable to UID 501 merely to preserve auto-discovery. Any exporter must be read-only and must not become a reverse control channel.

8. **Create an agent launcher that preserves the boundary.** cmux remains a UID-501 GUI application. A terminal pane must launch the agent command as UID A through a narrowly allowlisted mechanism. Ordinary `sudo -iu <agent>` prompts and loses some graphical-session/Keychain context; a no-password wildcard sudo rule would be a privilege-escalation bug. The acceptable choices are a fixed-argv privileged launcher, an agent-user service with a narrow request socket, or an interactive login to the agent account. Test provider Keychain and TTY behavior before choosing.

9. **Add browser pairing and route-complete authentication.** Generate the operator-side capability, pair the production browser explicitly, and require it on every mutation. Cover `/api/control` and `/api/broadcast` together; do not repeat the current split freshness policy. Give preview instances a distinct development capability and no access to the production cmux credential by default.

10. **Pilot one provider in one fresh clone.** Do not migrate the existing 30 lane directories and 32 registered worktrees up front. Run one low-risk agent session from UID A. Verify editing, Git authorship, package installation, session collection, cmux focus/instruct/interrupt, and generated-file ownership.

11. **Run negative security tests.** From UID A, prove that the cmux socket fails with permission/authorization denial, the operator's cmux password and browser capability cannot be read, a forged-Origin control request without the capability returns 401, and no cmux action occurs. From the paired UID-501 browser, prove one current-lease instruction works and a stale lease is rejected. Inspect the broker/controller log for exactly one submission.

12. **Migrate one provider at a time.** Recreate only active clones/worktrees, issue provider-specific credentials, and update collectors. Disable that provider's UID-501 launcher after its acceptance test. Keep a written machine manifest of account UID, group, roots, installed CLI versions, credential owners, and launchd labels.

13. **Soak and rotate.** Run for at least a working week. Rotate the cmux password and Ant Hill browser capability after the last UID-501 agent process is gone. Search for old copies in preview directories, launchd environments, shell history, and project data without printing their values.

14. **Retire old state last.** Removing old worktrees, credentials, Keychain items, or the agent account is destructive. Back up needed session history, revoke remote credentials before deleting local material, and require an explicit operator confirmation for each deletion. No deletion is part of the pilot.

### Rollback

The pilot is reversible if the original account and worktrees are left untouched:

1. Stop launching new UID-A sessions.
2. Revoke the pilot's provider, GitHub, SSH, and API credentials remotely.
3. Disable only the pilot launcher/exporter; leave the current Ant Hill LaunchAgent and cmux untouched.
4. Restore the original UID-501 browser/control configuration and rotate its capability.
5. Return active work through reviewed commits or patches; do not copy an entire UID-A worktree over an operator-owned one.
6. Archive any required agent session records.
7. Remove the pilot clone and account only after explicit approval. Account deletion and Keychain destruction are irreversible once backups and remote recovery are gone.

A rollout that first changes ownership of the existing worktree fleet is not safely reversible and is not recommended.

## Cost

### Implementation cost

The literal separate-user broker is a no-build because it cannot reach current cmux and does not authenticate same-UID callers.

The conditional separate-agent-user architecture is approximately **8–10 focused lanes over four waves**, plus operator migration and soak:

| Wave | Lanes | Work |
|---|---:|---|
| feasibility pilot | 2 | non-admin account/shared-repo launcher; one provider and one clone |
| control boundary | 2 | route-complete browser capability; centralized leases and narrow controller API |
| observability | 2 | multi-home collectors or sanitized exporter; cmux attention/hook compatibility |
| operations and assurance | 2–4 | preview/deploy changes, machine manifest, provider migrations, adversarial tests, rollback runbook |

Expect **one to two operator days** for the first provider/machine, followed by a working-week soak. Migrating all active providers and only the worktrees still in use is additional operator time that cannot be automated safely because each credential and ownership decision is security-sensitive.

Meeting the original any-UID-501 threat adds a cmux authorization project and a native trusted UI path: approximately **3–5 more lanes over at least two waves**, with an upstream dependency or maintained fork. The total becomes roughly **11–15 lanes over six waves**, before upstream review time.

### Ongoing operational cost

The operator must maintain:

- two user homes, Keychains, shells, CLI installations, caches, and update state;
- separate SSH, GitHub, provider, registry, and cloud credentials and revocation procedures;
- shared-repository group/ACL behavior and generated-file ownership;
- a launcher that does not broaden sudo authority;
- collector paths and per-user `launchd` domains;
- production versus preview control credentials;
- a per-machine manifest and setup procedure;
- provider licensing/seat implications;
- negative boundary tests after cmux, Bun, launcher, or macOS upgrades.

macOS upgrades can reset Login Items/helper approval, change background-task behavior, or expose Keychain/session assumptions. A new Mac requires recreating accounts, groups, ACLs, logins, Keychains, provider credentials, LaunchAgents/helpers, browser pairing, and exact paths. User IDs must be measured, not copied blindly between machines.

cmux upgrades require rechecking socket modes and the exact authorization source/behavior before assuming cross-user or password semantics are unchanged.

## What it breaks

### Local scripts and curl

- Existing unauthenticated mutating `curl` calls receive 401 after route authentication. Health/read-only endpoints may remain credential-free if they expose no sensitive state.
- Scripts must read a deliberately provisioned capability or invoke a paired helper. Printing or embedding the token in argv, logs, source, shell history, or an unauthenticated endpoint defeats it.
- Any script run as UID A must be unable to obtain the production capability.

### Deploy and hygiene scripts

The current deploy/hygiene flow targets `gui/$UID/ai.imaginethat.anthill` and validates the loopback HTTP server. It does not install or manage another user's service, a native helper, shared-root ACLs, or browser pairing. It must gain explicit per-component health checks and must never restart the agent-user side as an accidental consequence of deploying the UID-501 dashboard.

If a native privileged launcher is added, installation/removal requires an admin-approved ServiceManagement flow and a separate rollback. It cannot be treated as another Bun file copy.

### Preview server

The preview script currently copies the source/configuration and `data/cmux-socket.env` into a temporary tree. Under the new model, an arbitrary preview under UID 501 is as trusted as production and can control production cmux. Previews must default to monitor-only, use a fake/test cmux transport, or receive an explicitly separate short-lived development capability. Peer UID checks cannot distinguish a preview from production when both use UID 501.

### Agent launch and cmux features

- cmux-created panes normally inherit the operator identity. Each agent pane now needs the approved identity-changing launcher.
- Agent-side cmux hooks, notifications, socket RPC, and capability inheritance fail because cmux rejects UID A. Required status must travel through a one-way, narrow exporter or be collected from the trusted side.
- UID-A processes may not have access to the UID-501 graphical login Keychain. Provider CLIs that assume it will prompt, fail, or require a separate UID-A graphical session.
- Files generated by agents are UID A-owned. Builds, formatters, editors, and cleanup scripts under UID 501 need tested group permissions; broad `chmod` or recursive ownership fixes are not acceptable.

### Existing worktrees and absolute paths

The present fleet contains about 30 lane directories and 32 registered Git worktrees, with paths and shared Git metadata owned by UID 501. They cannot be transparently reused by another UID without broadening permissions and risking Git metadata corruption. Fresh UID-A clones/worktrees change every absolute path used by scripts, saved sessions, collectors, and agent instructions.

### Second-person dogfooding and another Mac

A second person cannot copy the operator's capability or account state. Their Mac needs its own account split, credentials, browser pairing, exact UID/group discovery, helper approval, paths, and negative tests. If they run agents under their normal user, the security claim does not apply on their machine.

## Alternatives reconsidered

The original alternatives were local capability token, human pairing/per-session approval, OS-enforced separation, and explicit acceptance of the same-UID boundary.

### Recommended value-for-risk decision

Do **not** build the literal option 3. Implement option 1 as defense in depth, pair it with the most useful part of option 2 for sensitive actions, and document option 4 honestly until a separate-agent-user pilot is approved.

- A local capability token is relatively inexpensive and blocks accidental, cross-account, and uncredentialed loopback callers. It becomes a real cross-account control after agents move to UID A. It is not protection from UID-501 malware.
- Human pairing or per-session approval reduces ambient control and limits unattended use. Per-action operator presence—ideally backed by a native Touch ID/Keychain access-control flow—provides more value against same-UID automation than a reusable bearer token, though direct cmux access remains until cmux authorization changes.
- Explicitly accepting the same-UID boundary accurately describes today's system: loopback Host and Origin checks defend web-origin attacks, while local operator-account processes are trusted.

If the operator cannot accept that boundary, the next dependency is not an Ant Hill broker. It is a cmux authorization design that:

1. refuses arbitrary same-UID clients;
2. recognizes one signed controller by audit token/code-signing requirement or an equivalent OS-bound identity;
3. exposes a narrow method allowlist;
4. cannot be bypassed through the existing password/socket mode;
5. supports the operator's graphical session.

Only after cmux supplies that primitive does a signed native broker/UI solve the original threat without moving the entire control desktop to another account.

## Concrete first increment

The smallest increment with independently verifiable security value is a **one-provider, one-clone, separate-user pilot plus route-complete capability authentication**. It is not a broker implementation.

Scope:

1. Create one non-admin agent account and one fresh low-risk clone.
2. Provision one least-privilege provider credential to that account.
3. Launch only that agent identity through one fixed, reviewed mechanism.
4. Require an explicitly paired capability on both `/api/control` and `/api/broadcast`.
5. Move freshness/lease validation into the common privileged execution path.
6. Keep preview instances monitor-only with respect to production cmux.
7. Leave all existing worktrees, accounts, services, and credentials untouched.

Acceptance evidence:

- From UID A, opening or invoking the cmux socket is denied.
- From UID A, the operator's cmux password, browser capability, and browser profile are unreadable.
- From UID A, a loopback mutation with forged `Host`/`Origin` but no capability receives 401 and emits no cmux command.
- From the paired UID-501 browser, focus, one instruction, and interrupt work for a current lease.
- A lease older than 30 seconds is rejected for both single control and broadcast with no cmux command.
- An unknown `send_text`/Enter delivery result is reported for reconciliation and never retried automatically.
- Stopping the pilot and revoking its provider credential restores the prior workflow without changing the existing service or worktrees.

This pilot proves the only security claim available with the installed stack: a process under the separated agent identity cannot control the operator's cmux through either its socket or Ant Hill. If that daily workflow is unacceptable, stop there and retain the explicit same-UID trust boundary. If it is acceptable, the operator can authorize staged provider migration with measured costs instead of committing to a big-bang redesign.

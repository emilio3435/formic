# Claude Desktop Send evidence

Checked 2026-08-18. This note covers the Claude.app GUI only. Claude Code running in a cmux pane remains an exact, writable CLI surface.

## What Formic can read

- The supported Claude collector reads `~/.claude/projects/**/*.jsonl`: `collectSessionProvider("claude")` routes that tree through `parseClaudeJsonl` in `src/server/collectors.ts`.
- A metadata-only macOS inspection found a separate `~/Library/Application Support/Claude/local-agent-mode-sessions` tree containing JSONL files. Formic has no collector route for that directory. The files were not opened and their undocumented schema was not treated as a conversation contract.

Filesystem visibility is not source compatibility. Formic can parse the Claude Code project records; it can only enumerate the existence of the separate Desktop store without scraping or assigning meaning to a private format.

## Write-surface evidence

- Claude.app identifies itself as `com.anthropic.claudefordesktop` and registers the `claude` URL scheme. Its bundle exposes no scripting definition, and `NSAppleScriptEnabled` is absent.
- [Anthropic's documented Claude Desktop links](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link) open destinations. A `q` parameter prefills a new chat for the user to review and send; existing-chat links open the chat. Neither operation attests message submission.
- `src/server/claude-desktop.ts` therefore resolves Claude Desktop to a non-writable `claude-desktop` target. `tests/claude-desktop-refusal.test.ts` pins a disabled Send, no `claude://...q=` command, and an empty command log for an instruct attempt. The same test keeps Claude Code in cmux writable.

## Decision

There is no attested official Claude Desktop write surface to implement safely. Formic does not add a Send button or adapter, does not drive the GUI, and does not inspect a private protocol. Revisit only when Anthropic documents a write API or a link/RPC that submits a message rather than prefilling one.

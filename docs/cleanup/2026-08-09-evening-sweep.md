# Cleanup — 2026-08-09 evening (ant-panel + health-rail-v2 program close)

**Removed** (undo command beside each):
- Worktrees: hr2-p1-server, hr2-p2-markup, hr2-p3-catalog, hr2-phase2-ui, tw-ui-grok (mid-program), then ant-rhs-chat-opus, ant-task-parser-luna, health-rail-tldr-design, health-rail-tldr-review — undo: `git worktree add <path> <tag-or-branch>`. All lane evidence archived to `docs/programs/*/reports/` BEFORE removal (verified file-by-file for chat's 15).
- Branches (tagged first): feat/hr2-p1-server, feat/hr2-p2-markup, feat/hr2-p3-catalog, feat/ant-rhs-chat-opus — undo: `git branch <name> zz-archive/ant-panel-hr2/<name-with-dashes>`.
- cmux workspaces 24–28 (lane panes) closed.

**Kept, tagged, `-d` refused** (tiny unmerged doc tails; delete after PR #24 lands if desired): feat/hr2-phase2-fold-in, feat/tw-ui-anatomy, feat/ant-task-parser-luna (cherry-equivalent of landed 38636c7/6678e65), design/health-rail-tldr-fold-in.

**Untouched (UNKNOWN / foreign)**: OBB verify worktrees (dirty, active foreign program), the-mountain (feat/inspector-instrument-panel — operator's), cwd-semantics pair, ant-hill/luna-* July branches, both stashes, `tw-ui-grok/` leftover dir (.gstack + data runtime junk — needs recursive rm, operator keystroke: `rm -rf ../the-mountain.worktrees/tw-ui-grok`).

Blocked-and-rewritten during sweep: `find -delete` → enumerated per-file rm; `git restore` → `git show HEAD:<file> >` recovery.

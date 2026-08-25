PRAGMA foreign_keys = ON;

CREATE TABLE `project` (
  `id` text PRIMARY KEY,
  `worktree` text NOT NULL,
  `vcs` text,
  `name` text,
  `icon_url` text,
  `icon_url_override` text,
  `icon_color` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_initialized` integer,
  `sandboxes` text NOT NULL,
  `commands` text
);

CREATE TABLE `session` (
  `id` text PRIMARY KEY,
  `project_id` text NOT NULL,
  `workspace_id` text,
  `parent_id` text,
  `slug` text NOT NULL,
  `directory` text NOT NULL,
  `path` text,
  `title` text NOT NULL,
  `version` text NOT NULL,
  `share_url` text,
  `summary_additions` integer,
  `summary_deletions` integer,
  `summary_files` integer,
  `summary_diffs` text,
  `metadata` text,
  `cost` real DEFAULT 0 NOT NULL,
  `tokens_input` integer DEFAULT 0 NOT NULL,
  `tokens_output` integer DEFAULT 0 NOT NULL,
  `tokens_reasoning` integer DEFAULT 0 NOT NULL,
  `tokens_cache_read` integer DEFAULT 0 NOT NULL,
  `tokens_cache_write` integer DEFAULT 0 NOT NULL,
  `revert` text,
  `permission` text,
  `agent` text,
  `model` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_compacting` integer,
  `time_archived` integer,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);

CREATE TABLE `message` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);

CREATE TABLE `part` (
  `id` text PRIMARY KEY,
  `message_id` text NOT NULL,
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,
  FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE
);

-- Present only as a tripwire: the parser contract forbids querying this
-- disposable projection, even when it contains newer contradictory text.
CREATE TABLE `session_message` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `type` text NOT NULL,
  `seq` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);

CREATE TABLE `migration` (
  `id` text PRIMARY KEY,
  `time_completed` integer NOT NULL
);

CREATE INDEX `message_session_time_created_id_idx`
  ON `message` (`session_id`, `time_created`, `id`);
CREATE INDEX `part_message_id_id_idx` ON `part` (`message_id`, `id`);
CREATE INDEX `part_session_idx` ON `part` (`session_id`);
CREATE INDEX `session_parent_idx` ON `session` (`parent_id`);

INSERT INTO `migration` (`id`, `time_completed`) VALUES
  ('0000_legacy_drizzle_import', 1784688000000),
  ('20260622202450_simplify_session_input', 1784688000001);

INSERT INTO `project` (
  `id`, `worktree`, `vcs`, `name`, `time_created`, `time_updated`, `sandboxes`
) VALUES (
  'prj_synthetic', '/synthetic/workspace', 'git', 'Synthetic project',
  1784688000000, 1784689180000, '[]'
);

INSERT INTO `session` (
  `id`, `project_id`, `parent_id`, `slug`, `directory`, `path`, `title`, `version`,
  `cost`, `tokens_input`, `tokens_output`, `tokens_reasoning`,
  `tokens_cache_read`, `tokens_cache_write`, `agent`, `model`,
  `time_created`, `time_updated`, `time_archived`
) VALUES
  (
    'ses_synthetic_root', 'prj_synthetic', NULL, 'synthetic-root',
    '/synthetic/workspace/parser-lab', 'parser-lab',
    'Synthetic parser contract', 'local-test', 12.34,
    120, 30, 7, 400, 11, 'build',
    '{"id":"model-alpha","providerID":"route-synthetic","variant":"high"}',
    1784689000000, 1784689180000, NULL
  ),
  (
    'ses_synthetic_child', 'prj_synthetic', 'ses_synthetic_root', 'synthetic-child',
    '/synthetic/workspace/parser-lab/child', 'parser-lab/child',
    'New session - 2026-07-21T19:20:00.000Z', 'local-test', 0,
    0, 0, 0, 0, 0, 'build', NULL,
    1784689100000, 1784689120000, 1784689130000
  );

INSERT INTO `message` (`id`, `session_id`, `time_created`, `time_updated`, `data`) VALUES
  (
    'msg_synthetic_user_1', 'ses_synthetic_root', 1784689010000, 1784689010000,
    '{"role":"user","time":{"created":1784689010000},"agent":"build","model":{"providerID":"route-synthetic","modelID":"model-alpha","variant":"high"}}'
  ),
  (
    'msg_synthetic_assistant_1', 'ses_synthetic_root', 1784689020000, 1784689050000,
    '{"role":"assistant","time":{"created":1784689020000,"completed":1784689050000},"parentID":"msg_synthetic_user_1","modelID":"model-alpha","providerID":"route-synthetic","mode":"build","agent":"build","path":{"cwd":"/synthetic/workspace/parser-lab","root":"/synthetic/workspace"},"cost":4.56,"tokens":{"total":415,"input":76,"output":18,"reasoning":4,"cache":{"read":310,"write":7}},"variant":"high","finish":"tool-calls"}'
  ),
  (
    'msg_synthetic_user_2', 'ses_synthetic_root', 1784689060000, 1784689060000,
    '{"role":"user","time":{"created":1784689060000},"agent":"build","model":{"providerID":"route-synthetic","modelID":"model-alpha","variant":"high"}}'
  ),
  (
    'msg_synthetic_assistant_2', 'ses_synthetic_root', 1784689070000, 1784689180000,
    '{"role":"assistant","time":{"created":1784689070000,"completed":1784689180000},"parentID":"msg_synthetic_user_2","modelID":"model-alpha","providerID":"route-synthetic","mode":"build","agent":"build","path":{"cwd":"/synthetic/workspace/parser-lab/subdir","root":"/synthetic/workspace"},"cost":7.78,"tokens":{"total":153,"input":44,"output":12,"reasoning":3,"cache":{"read":90,"write":4}},"variant":"high","finish":"stop"}'
  );

INSERT INTO `part` (`id`, `message_id`, `session_id`, `time_created`, `time_updated`, `data`) VALUES
  (
    'prt_synthetic_user_1_text', 'msg_synthetic_user_1', 'ses_synthetic_root',
    1784689010001, 1784689010001,
    '{"type":"text","text":"Prove the bounded OpenCode parser contract."}'
  ),
  (
    'prt_synthetic_assistant_1_reasoning', 'msg_synthetic_assistant_1', 'ses_synthetic_root',
    1784689020001, 1784689020002,
    '{"type":"reasoning","text":"Check native relationship keys.","time":{"start":1784689020001,"end":1784689020002}}'
  ),
  (
    'prt_synthetic_assistant_1_tool', 'msg_synthetic_assistant_1', 'ses_synthetic_root',
    1784689030000, 1784689040000,
    '{"type":"tool","callID":"call_synthetic_inspect","tool":"inspect","state":{"status":"completed","input":{},"output":"Synthetic inspection complete.","title":"Inspect synthetic schema","metadata":{},"time":{"start":1784689030000,"end":1784689040000}}}'
  ),
  (
    'prt_synthetic_assistant_1_text', 'msg_synthetic_assistant_1', 'ses_synthetic_root',
    1784689040001, 1784689040001,
    '{"type":"text","text":"The first bounded pass preserves native IDs."}'
  ),
  (
    'prt_synthetic_assistant_1_finish', 'msg_synthetic_assistant_1', 'ses_synthetic_root',
    1784689050000, 1784689050000,
    '{"type":"step-finish","reason":"tool-calls","cost":4.56,"tokens":{"total":415,"input":76,"output":18,"reasoning":4,"cache":{"read":310,"write":7}}}'
  ),
  (
    'prt_synthetic_user_2_text', 'msg_synthetic_user_2', 'ses_synthetic_root',
    1784689060001, 1784689060001,
    '{"type":"text","text":"Confirm the final bounded evidence."}'
  ),
  (
    'prt_synthetic_assistant_2_text', 'msg_synthetic_assistant_2', 'ses_synthetic_root',
    1784689170000, 1784689170000,
    '{"type":"text","text":"Parser evidence is bounded and relationships are intact."}'
  ),
  (
    'prt_synthetic_assistant_2_finish', 'msg_synthetic_assistant_2', 'ses_synthetic_root',
    1784689180000, 1784689180000,
    '{"type":"step-finish","reason":"stop","cost":7.78,"tokens":{"total":153,"input":44,"output":12,"reasoning":3,"cache":{"read":90,"write":4}}}'
  );

INSERT INTO `session_message` (
  `id`, `session_id`, `type`, `seq`, `time_created`, `time_updated`, `data`
) VALUES (
  'msg_projection_tripwire', 'ses_synthetic_root', 'user', 999,
  1784689190000, 1784689190000,
  '{"text":"REJECTED_PROJECTION_TEXT_MUST_NEVER_APPEAR","time":{"created":1784689190000}}'
);

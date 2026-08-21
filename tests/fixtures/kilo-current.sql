PRAGMA foreign_keys = ON;

CREATE TABLE `project` (
  `id` text PRIMARY KEY,
  `worktree` text NOT NULL,
  `vcs` text,
  `name` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `sandboxes` text NOT NULL
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
  `cost` real DEFAULT 0 NOT NULL,
  `tokens_input` integer DEFAULT 0 NOT NULL,
  `tokens_output` integer DEFAULT 0 NOT NULL,
  `tokens_reasoning` integer DEFAULT 0 NOT NULL,
  `tokens_cache_read` integer DEFAULT 0 NOT NULL,
  `tokens_cache_write` integer DEFAULT 0 NOT NULL,
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

-- Contradictory V2 rows are tripwires only. Canonical transcript evidence is
-- always the native V1 message-to-part relationship above.
CREATE TABLE `session_message` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `type` text NOT NULL,
  `seq` integer,
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
  ('0000_synthetic_legacy_journal_name', 1800000000000),
  ('20260127222353_familiar_lady_ursula', 1800000000001),
  ('20260211171708_add_project_commands', 1800000000002),
  ('20260213144116_wakeful_the_professor', 1800000000003),
  ('20260225215848_workspace', 1800000000004),
  ('20260227213759_add_session_workspace_id', 1800000000005),
  ('20260228203230_blue_harpoon', 1800000000006),
  ('20260303231226_add_workspace_fields', 1800000000007),
  ('20260309230000_move_org_to_state', 1800000000008),
  ('20260312043431_session_message_cursor', 1800000000009),
  ('20260323234822_events', 1800000000010),
  ('20260410174513_workspace-name', 1800000000011),
  ('20260413175956_chief_energizer', 1800000000012),
  ('20260423070820_add_icon_url_override', 1800000000013),
  ('20260427172553_slow_nightmare', 1800000000014),
  ('20260428004200_add_session_path', 1800000000015),
  ('20260501142318_next_venus', 1800000000016),
  ('20260504145000_add_sync_owner', 1800000000017),
  ('20260507164347_add_workspace_time', 1800000000018),
  ('20260510033149_session_usage', 1800000000019),
  ('20260511000411_data_migration_state', 1800000000020),
  ('20260511173437_session-metadata', 1800000000021),
  ('20260601010001_normalize_storage_paths', 1800000000022),
  ('20260601202201_amazing_prowler', 1800000000023),
  ('20260602002951_lowly_union_jack', 1800000000024),
  ('20260602182828_add_project_directories', 1800000000025),
  ('20260603001617_session_message_projection_indexes', 1800000000026),
  ('20260603040000_session_message_projection_order', 1800000000027),
  ('20260603141458_session_input_inbox', 1800000000028),
  ('20260603160727_jittery_ezekiel_stane', 1800000000029),
  ('20260604172448_event_sourced_session_input', 1800000000030),
  ('20260605003541_add_session_context_snapshot', 1800000000031),
  ('20260605042240_add_context_epoch_agent', 1800000000032),
  ('20260611035744_credential', 1800000000033),
  ('20260611192811_lush_chimera', 1800000000034),
  ('20260612174303_project_dir_strategy', 1800000000035),
  ('20260622142730_simplify_session_context_epoch', 1800000000036),
  ('20260622170816_reset_v2_session_state', 1800000000037),
  ('20260622202450_simplify_session_input', 1800000000038),
  ('20260714141136_session-message-legacy-writer-compat', 1800000000039);

INSERT INTO `project` (
  `id`, `worktree`, `vcs`, `name`, `time_created`, `time_updated`, `sandboxes`
) VALUES (
  'prj_fixture', '/synthetic/kilo/project', 'git', 'Invented parser project',
  1800000000100, 1800000009000, '[]'
);

INSERT INTO `session` (
  `id`, `project_id`, `parent_id`, `slug`, `directory`, `path`, `title`, `version`,
  `cost`, `tokens_input`, `tokens_output`, `tokens_reasoning`,
  `tokens_cache_read`, `tokens_cache_write`, `agent`, `model`,
  `time_created`, `time_updated`, `time_archived`
) VALUES
  (
    'ses_fixture_root', 'prj_fixture', NULL, 'fixture-root',
    '/synthetic/kilo/project/root', 'root', 'Invented Kilo parser session', 'synthetic',
    12.34, 10, 4, 1, 8, 2, 'build',
    '{"id":"model-invented","providerID":"provider-invented","variant":"high"}',
    1800000001000, 1800000008000, NULL
  ),
  (
    'ses_fixture_child', 'prj_fixture', 'ses_fixture_root', 'fixture-child',
    '/synthetic/kilo/project/child', 'child',
    'Child session - 2026-01-02T03:04:05.000Z', 'synthetic',
    0, 0, 0, 0, 0, 0, 'build', NULL,
    1800000002000, 1800000003000, NULL
  ),
  (
    'ses_fixture_archived', 'prj_fixture', NULL, 'fixture-archived',
    '/synthetic/kilo/project/archived', 'archived', 'Invented archived session', 'synthetic',
    0, 1, 1, 0, 0, 0, 'build',
    '{"id":"archive-model","providerID":"provider-invented"}',
    1800000003000, 1800000004000, 1800000005000
  ),
  (
    'ses_fixture_placeholder', 'prj_fixture', NULL, 'fixture-placeholder',
    '/synthetic/kilo/project/placeholder', 'placeholder',
    'New session - 2026-01-02T03:04:05.000Z', 'synthetic',
    0, 0, 0, 0, 0, 0, 'build', NULL,
    1800000004000, 1800000004500, NULL
  );

INSERT INTO `message` (`id`, `session_id`, `time_created`, `time_updated`, `data`) VALUES
  (
    'msg_fixture_user_1', 'ses_fixture_root', 1800000001100, 1800000001100,
    '{"role":"user","time":{"created":1800000001100},"agent":"build","model":{"providerID":"provider-invented","modelID":"model-invented","variant":"high"}}'
  ),
  (
    'msg_fixture_assistant_1', 'ses_fixture_root', 1800000001200, 1800000001500,
    '{"role":"assistant","time":{"created":1800000001200,"completed":1800000001500},"parentID":"msg_fixture_user_1","modelID":"model-invented","providerID":"provider-invented","mode":"build","agent":"build","path":{"cwd":"/synthetic/kilo/project/root","root":"/synthetic/kilo/project"},"tokens":{"total":9,"input":5,"output":3,"reasoning":1,"cache":{"read":2,"write":1}},"variant":"high","finish":"tool-calls"}'
  ),
  (
    'msg_fixture_user_2', 'ses_fixture_root', 1800000002000, 1800000002000,
    '{"role":"user","time":{"created":1800000002000},"agent":"build","model":{"providerID":"provider-invented","modelID":"model-invented","variant":"high"}}'
  ),
  (
    'msg_fixture_assistant_2', 'ses_fixture_root', 1800000002100, 1800000008000,
    '{"role":"assistant","time":{"created":1800000002100,"completed":1800000008000},"parentID":"msg_fixture_user_2","modelID":"model-invented","providerID":"provider-invented","mode":"build","agent":"build","path":{"cwd":"/synthetic/kilo/project/root/recent","root":"/synthetic/kilo/project"},"tokens":{"total":6,"input":4,"output":2,"reasoning":0,"cache":{"read":1,"write":0}},"variant":"high","finish":"stop"}'
  );

INSERT INTO `part` (`id`, `message_id`, `session_id`, `time_created`, `time_updated`, `data`) VALUES
  (
    'prt_fixture_user_1_text', 'msg_fixture_user_1', 'ses_fixture_root',
    1800000001101, 1800000001101,
    '{"type":"text","text":"Prove the invented Kilo V1 authority."}'
  ),
  (
    'prt_fixture_user_1_synthetic', 'msg_fixture_user_1', 'ses_fixture_root',
    1800000001102, 1800000001102,
    '{"type":"text","text":"IGNORED_SYNTHETIC_SPEECH","synthetic":true}'
  ),
  (
    'prt_fixture_assistant_1_reasoning', 'msg_fixture_assistant_1', 'ses_fixture_root',
    1800000001201, 1800000001202,
    '{"type":"reasoning","text":"Check only invented native relationships.","time":{"start":1800000001201,"end":1800000001202}}'
  ),
  (
    'prt_fixture_assistant_1_tool', 'msg_fixture_assistant_1', 'ses_fixture_root',
    1800000001300, 1800000001400,
    '{"type":"tool","callID":"call_fixture_inspect","tool":"inspect","state":{"status":"completed","input":{"target":"synthetic-schema"},"output":"INVENTED_TOOL_BODY_MUST_NOT_PUBLISH","title":"Inspect invented schema","metadata":{},"time":{"start":1800000001300,"end":1800000001400}}}'
  ),
  (
    'prt_fixture_assistant_1_text', 'msg_fixture_assistant_1', 'ses_fixture_root',
    1800000001401, 1800000001401,
    '{"type":"text","text":"The first invented Kilo pass preserves native IDs."}'
  ),
  (
    'prt_fixture_assistant_1_finish', 'msg_fixture_assistant_1', 'ses_fixture_root',
    1800000001500, 1800000001500,
    '{"type":"step-finish","reason":"tool-calls","cost":4.56,"tokens":{"total":9,"input":5,"output":3,"reasoning":1,"cache":{"read":2,"write":1}}}'
  ),
  (
    'prt_fixture_user_2_text', 'msg_fixture_user_2', 'ses_fixture_root',
    1800000002001, 1800000002001,
    '{"type":"text","text":"Confirm the final invented Kilo evidence."}'
  ),
  (
    'prt_fixture_assistant_2_text', 'msg_fixture_assistant_2', 'ses_fixture_root',
    1800000007900, 1800000007900,
    '{"type":"text","text":"Invented Kilo evidence is bounded and complete."}'
  ),
  (
    'prt_fixture_assistant_2_finish', 'msg_fixture_assistant_2', 'ses_fixture_root',
    1800000008000, 1800000008000,
    '{"type":"step-finish","reason":"stop","cost":7.78,"tokens":{"total":6,"input":4,"output":2,"reasoning":0,"cache":{"read":1,"write":0}}}'
  );

INSERT INTO `session_message` (
  `id`, `session_id`, `type`, `seq`, `time_created`, `time_updated`, `data`
) VALUES
  (
    'msg_v2_sequenced_tripwire', 'ses_fixture_root', 'user', 1,
    1800000009000, 1800000009000,
    '{"text":"REJECTED_SEQUENCED_V2_TEXT","time":{"created":1800000009000}}'
  ),
  (
    'msg_v2_null_seq_tripwire', 'ses_fixture_root', 'assistant', NULL,
    1800000009100, 1800000009100,
    '{"text":"REJECTED_NULL_SEQ_V2_TEXT","time":{"created":1800000009100}}'
  );

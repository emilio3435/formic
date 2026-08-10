import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.dont_write_bytecode = True
SCRIPT = pathlib.Path(
    os.environ.get(
        "ANT_HILL_REFINER_MODULE",
        pathlib.Path(__file__).parents[1] / "scripts/ant-hill-task-refine.py",
    )
)
SPEC = importlib.util.spec_from_file_location("ant_hill_task_refine", SCRIPT)
assert SPEC and SPEC.loader
refiner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = refiner
SPEC.loader.exec_module(refiner)

HEADER_SCRIPT = pathlib.Path(__file__).parents[1] / "scripts/ant-hill-header-per-repo.py"
HEADER_SPEC = importlib.util.spec_from_file_location("ant_hill_header_per_repo", HEADER_SCRIPT)
assert HEADER_SPEC and HEADER_SPEC.loader
header = importlib.util.module_from_spec(HEADER_SPEC)
sys.modules[HEADER_SPEC.name] = header
HEADER_SPEC.loader.exec_module(header)


def agent(**overrides):
    value = {
        "id": "codex:worker-1",
        "provider": "codex",
        "lifecycle": "working",
        "sessionKind": "work",
        "task": "Implement the stable summary row",
        "lastHumanMessage": "Please implement the stable summary row",
    }
    value.update(overrides)
    return value


class EligibilityTests(unittest.TestCase):
    def test_self_and_automation_sessions_are_ineligible(self):
        self.assertFalse(refiner.eligible_agent(agent(sessionKind="automation")))
        self.assertFalse(
            refiner.eligible_agent(
                agent(task="You are Task refiner for Ant Hill. Summarize this task")
            )
        )
        self.assertFalse(
            refiner.eligible_agent(agent(id="codex:self"), self_session_id="codex:self")
        )
        self.assertTrue(refiner.eligible_agent(agent()))


class LauncherTests(unittest.TestCase):
    def test_launcher_is_direct_ephemeral_luna_low_and_reads_stdin(self):
        command = refiner.build_codex_command(
            pathlib.Path("/tmp/repo with spaces"), codex_bin="/opt/codex binary"
        )
        self.assertEqual(
            command,
            [
                "/opt/codex binary",
                "exec",
                "--sandbox",
                "read-only",
                "--ephemeral",
                "--json",
                "--model",
                "gpt-5.6-luna",
                "-c",
                "model_reasoning_effort=low",
                "--cd",
                "/tmp/repo with spaces",
                "-",
            ],
        )

    def test_json_events_supply_one_final_message_and_terminal_usage(self):
        stdout = "\n".join(
            [
                json.dumps({"type": "thread.started", "thread_id": "ephemeral-1"}),
                json.dumps(
                    {
                        "type": "item.completed",
                        "item": {
                            "type": "agent_message",
                            "text": "Implement stable task summaries without recursive automation sessions",
                        },
                    }
                ),
                json.dumps(
                    {
                        "type": "turn.completed",
                        "usage": {
                            "input_tokens": 100,
                            "cached_input_tokens": 40,
                            "cache_write_input_tokens": 10,
                            "output_tokens": 20,
                            "reasoning_output_tokens": 5,
                            "total_tokens": 120,
                        },
                    }
                ),
            ]
        )
        parsed = refiner.parse_codex_events(stdout)
        self.assertEqual(parsed["threadId"], "ephemeral-1")
        self.assertEqual(parsed["usage"]["cachedInputTokens"], 40)
        self.assertEqual(parsed["usage"]["reasoningOutputTokens"], 5)
        self.assertEqual(parsed["usage"]["totalTokens"], 120)

    def test_termination_stops_the_whole_ephemeral_process_group(self):
        runner = refiner.CodexRunner(pathlib.Path("/tmp/repo"), "http://127.0.0.1:4701/api/snapshot")

        class RunningProcess:
            pid = 4321

            @staticmethod
            def poll():
                return None

        runner.process = RunningProcess()
        with patch.object(refiner.os, "killpg") as killpg:
            runner.terminate()
        killpg.assert_called_once_with(4321, refiner.signal.SIGTERM)

    def test_unknown_baseline_fails_closed_before_starting_codex(self):
        with tempfile.TemporaryDirectory() as root:
            safety_path = pathlib.Path(root) / ".task-refiner-safety.json"
            runner = refiner.CodexRunner(
                pathlib.Path("/tmp/repo"),
                "http://127.0.0.1:4701/api/snapshot",
                safety_path=safety_path,
            )
            with patch.object(refiner, "persistent_codex_sessions", return_value=None), patch.object(
                refiner, "visible_refiner_count", return_value=0
            ), patch.object(refiner.subprocess, "Popen") as popen:
                with self.assertRaises(refiner.IsolationViolation):
                    runner("prompt")
            popen.assert_not_called()
            self.assertTrue(refiner.safety_circuit_open(safety_path))

    def test_timeout_with_leaked_transcript_is_accounted_and_trips_breaker(self):
        with tempfile.TemporaryDirectory() as root:
            safety_path = pathlib.Path(root) / ".task-refiner-safety.json"

            class TimeoutProcess:
                pid = 4321
                returncode = 0

                @staticmethod
                def poll():
                    return None

                def communicate(self, _prompt=None, timeout=None):
                    if timeout == refiner.DEFAULT_TIMEOUT_SECONDS:
                        raise subprocess.TimeoutExpired("codex", timeout)
                    return "", ""

            runner = refiner.CodexRunner(
                pathlib.Path("/tmp/repo"),
                "http://127.0.0.1:4701/api/snapshot",
                safety_path=safety_path,
            )
            with patch.object(
                refiner,
                "persistent_codex_sessions",
                side_effect=[set(), {"leaked-session"}],
            ), patch.object(
                refiner,
                "visible_refiner_count",
                side_effect=[0, 1],
            ), patch.object(refiner.subprocess, "Popen", return_value=TimeoutProcess()), patch.object(
                refiner.os, "killpg"
            ):
                with self.assertRaises(refiner.IsolationViolation) as raised:
                    runner("prompt")
            self.assertEqual(raised.exception.persistent_session_delta, 1)
            self.assertEqual(raised.exception.visible_session_delta, 1)
            self.assertTrue(refiner.safety_circuit_open(safety_path))


class EngineTests(unittest.TestCase):
    def test_first_isolation_violation_blocks_second_invocation_and_preserves_accounting(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []

            def leaked(_prompt):
                calls.append(True)
                return {
                    "summary": "Implement stable task summaries with singleton change detection and no recursive automation sessions",
                    "threadId": "leaked-thread",
                    "usage": {
                        "inputTokens": 100,
                        "cachedInputTokens": 40,
                        "cacheWriteTokens": 0,
                        "outputTokens": 20,
                        "reasoningOutputTokens": 5,
                        "totalTokens": 120,
                    },
                    "persistentSessionDelta": 1,
                    "visibleSessionDelta": 1,
                }

            engine = refiner.RefinerEngine(pathlib.Path(root), leaked, now=lambda: 1_786_290_000.0)
            turns = [
                {"role": "user", "text": "Implement the stable row"},
                {"role": "assistant", "text": "Working"},
            ]
            first = engine.process(agent(), turns)
            second = engine.process(agent(id="codex:worker-2"), turns)

            self.assertEqual(first["outcome"], "isolation_violation")
            self.assertEqual(second["outcome"], "skipped_circuit_open")
            self.assertEqual(len(calls), 1)
            self.assertFalse((pathlib.Path(root) / "codex_worker-1.txt").exists())
            ledger = [json.loads(line) for line in engine.ledger_path.read_text().splitlines()]
            self.assertEqual(ledger[0]["outcome"], "isolation_violation")
            self.assertEqual(ledger[0]["persistentSessionDelta"], 1)
            self.assertEqual(ledger[0]["visibleSessionDelta"], 1)
            self.assertEqual(ledger[0]["ephemeralThreadId"], "leaked-thread")

    def test_unknown_isolation_delta_is_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            def unknown(_prompt):
                return {
                    "summary": "Implement stable task summaries with singleton change detection and no recursive automation sessions",
                    "usage": {},
                    "persistentSessionDelta": 0,
                }

            engine = refiner.RefinerEngine(pathlib.Path(root), unknown)
            result = engine.process(
                agent(),
                [{"role": "user", "text": "Implement the stable row"}, {"role": "assistant", "text": "Working"}],
            )
            self.assertEqual(result["outcome"], "isolation_violation")
            self.assertTrue(refiner.safety_circuit_open(pathlib.Path(root) / ".task-refiner-safety.json"))

    def test_isolation_exception_keeps_known_deltas_in_the_ledger(self):
        with tempfile.TemporaryDirectory() as root:
            def leaked(_prompt):
                raise refiner.IsolationViolation(
                    "leaked transcript",
                    persistent_session_delta=1,
                    visible_session_delta=1,
                )

            engine = refiner.RefinerEngine(pathlib.Path(root), leaked)
            result = engine.process(
                agent(),
                [{"role": "user", "text": "Implement the stable row"}, {"role": "assistant", "text": "Working"}],
            )
            self.assertEqual(result["outcome"], "isolation_violation")
            ledger = [json.loads(line) for line in engine.ledger_path.read_text().splitlines()]
            self.assertEqual(ledger[0]["persistentSessionDelta"], 1)
            self.assertEqual(ledger[0]["visibleSessionDelta"], 1)

    def test_unchanged_fingerprint_invokes_once_and_changed_input_invokes_once_more(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []

            def run(prompt):
                calls.append(prompt)
                return {
                    "summary": "Implement stable task summaries with singleton change detection and no recursive automation sessions",
                    "threadId": f"thread-{len(calls)}",
                    "usage": {
                        "inputTokens": 100,
                        "cachedInputTokens": 40,
                        "cacheWriteTokens": 0,
                        "outputTokens": 20,
                        "reasoningOutputTokens": 5,
                        "totalTokens": 120,
                    },
                    "persistentSessionDelta": 0,
                    "visibleSessionDelta": 0,
                }

            engine = refiner.RefinerEngine(pathlib.Path(root), run, now=lambda: 1_786_290_000.0)
            turns = [
                {"role": "user", "text": "Implement the stable row"},
                {"role": "assistant", "text": "I am implementing it"},
            ]
            first = engine.process(agent(), turns)
            second = engine.process(agent(), turns)
            changed = engine.process(
                agent(lastHumanMessage="Also add durable accounting"),
                turns + [{"role": "user", "text": "Also add durable accounting"}],
            )

            self.assertEqual(first["outcome"], "success")
            self.assertEqual(second["outcome"], "skipped_unchanged")
            self.assertEqual(changed["outcome"], "success")
            self.assertEqual(len(calls), 2)
            ledger = [json.loads(line) for line in engine.ledger_path.read_text().splitlines()]
            self.assertEqual([row["outcome"] for row in ledger], ["success", "success"])
            self.assertTrue(all(row["persistentSessionDelta"] == 0 for row in ledger))
            self.assertTrue(all(row["visibleSessionDelta"] == 0 for row in ledger))

    def test_header_summarizer_honors_the_shared_safety_circuit(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []

            def leaked(_prompt):
                calls.append(True)
                return {
                    "summary": "The Mountain: 1 live=1w+0i · implement durable task refinement · no blockers reported",
                    "usage": {},
                    "persistentSessionDelta": 1,
                    "visibleSessionDelta": 1,
                }

            summarizer = header.HeaderSummarizer(pathlib.Path(root), leaked)
            agents = [agent(task="Implement durable task refinement")]
            first = summarizer.summarize("The Mountain", agents)
            second = summarizer.summarize(
                "The Mountain", [agent(task="Implement durable task refinement and accounting")]
            )
            self.assertEqual(first["outcome"], "isolation_violation")
            self.assertEqual(second["outcome"], "skipped_circuit_open")
            self.assertEqual(len(calls), 1)

    def test_failed_output_preserves_last_good_summary_and_stops_after_bounded_retries(self):
        with tempfile.TemporaryDirectory() as root:
            summary_root = pathlib.Path(root)
            summary_path = summary_root / "codex_worker-1.txt"
            summary_path.write_text("Preserve this last known good summary")
            calls = []

            def fail(_prompt):
                calls.append(True)
                raise RuntimeError("invalid model output")

            engine = refiner.RefinerEngine(summary_root, fail, now=lambda: 1_786_290_000.0)
            turns = [
                {"role": "user", "text": "Implement the stable row"},
                {"role": "assistant", "text": "Working"},
            ]
            self.assertEqual(engine.process(agent(), turns)["outcome"], "failed")
            self.assertEqual(engine.process(agent(), turns)["outcome"], "failed")
            self.assertEqual(engine.process(agent(), turns)["outcome"], "skipped_retry_exhausted")
            self.assertEqual(len(calls), 2)
            self.assertEqual(summary_path.read_text(), "Preserve this last known good summary")

    def test_header_summarizer_invokes_only_for_changed_repo_evidence_and_can_be_disabled(self):
        self.assertFalse(header.header_model_enabled({}))
        self.assertFalse(header.header_model_enabled({"ANT_HILL_HEADER_SUMMARIZER_ENABLED": "true"}))
        self.assertTrue(header.header_model_enabled({"ANT_HILL_HEADER_SUMMARIZER_ENABLED": "1"}))
        with tempfile.TemporaryDirectory() as root:
            calls = []

            def run(prompt):
                calls.append(prompt)
                return {
                    "summary": "The Mountain: 1 live=1w+0i · implement durable task refinement · no blockers reported",
                    "threadId": f"header-{len(calls)}",
                    "usage": {
                        "inputTokens": 100,
                        "cachedInputTokens": 40,
                        "cacheWriteTokens": 0,
                        "outputTokens": 20,
                        "reasoningOutputTokens": 5,
                        "totalTokens": 120,
                    },
                    "persistentSessionDelta": 0,
                    "visibleSessionDelta": 0,
                }

            summarizer = header.HeaderSummarizer(pathlib.Path(root), run)
            agents = [agent(task="Implement durable task refinement")]
            first = summarizer.summarize("The Mountain", agents)
            second = summarizer.summarize("The Mountain", agents)
            changed = summarizer.summarize(
                "The Mountain", [agent(task="Implement durable task refinement and accounting")]
            )

            self.assertTrue(first["invoked"])
            self.assertEqual(second["outcome"], "skipped_unchanged")
            self.assertTrue(changed["invoked"])
            self.assertEqual(len(calls), 2)

            disabled_calls = []

            def disabled_run(prompt):
                disabled_calls.append(prompt)
                return {}

            disabled = header.HeaderSummarizer(
                pathlib.Path(root) / "disabled",
                disabled_run,
                model_enabled=False,
            )
            skipped = disabled.summarize("The Mountain", agents)
            self.assertEqual(skipped["outcome"], "skipped_disabled")
            self.assertFalse(skipped["invoked"])
            self.assertEqual(disabled_calls, [])
            self.assertIsInstance(skipped["structured"], dict)
            self.assertEqual(skipped["structured"]["repo"], "The Mountain")
            self.assertTrue(skipped["structured"]["summary"].startswith("The Mountain:"))
            self.assertFalse(disabled.ledger_path.exists())

    def test_header_validator_accepts_concise_repo_lines_and_rejects_wrong_repos(self):
        concise = "Home: 2 live=1w+1i · durable task refinement · no blockers"
        self.assertEqual(header.validate_header_summary("Home", concise), concise)
        with self.assertRaises(ValueError):
            header.validate_header_summary("Home", concise.replace("Home:", "Other:"))

    def test_header_wire_envelope_stays_valid_json_under_the_transcript_cap(self):
        cards = [
            {
                "repo": f"repository-{index}",
                "summary": f"repository-{index}: " + "active task and evidence " * 8,
                "blocker": "question pending from integration owner",
                "signal": "needs-you",
            }
            for index in range(6)
        ]
        wire = header.build_wire_envelope(cards, max_chars=780)
        self.assertLessEqual(len(wire), 780)
        envelope = json.loads(wire)
        self.assertEqual(envelope["v"], 3)
        self.assertGreater(len(envelope["repos"]), 0)
        self.assertEqual(len(envelope["repos"]) + envelope.get("omitted", 0), 6)
        self.assertTrue(all(card["signal"] in header.ALLOWED_SIGNALS for card in envelope["repos"]))

    def test_header_fingerprint_ignores_activity_order_and_prioritizes_never_attempted_repos(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []

            def run(_prompt):
                calls.append(True)
                return {
                    "summary": "The Mountain: 2 live=2w+0i · implement durable task refinement · no blockers reported",
                    "usage": {
                        "inputTokens": 100,
                        "cachedInputTokens": 40,
                        "cacheWriteTokens": 0,
                        "outputTokens": 20,
                        "reasoningOutputTokens": 5,
                        "totalTokens": 120,
                    },
                    "persistentSessionDelta": 0,
                    "visibleSessionDelta": 0,
                }

            now = [100.0]
            summarizer = header.HeaderSummarizer(
                pathlib.Path(root), run, now=lambda: now[0]
            )
            agents = [
                agent(id="codex:a", activity={"quietForMs": 10}),
                agent(id="codex:b", activity={"quietForMs": 20}),
            ]
            self.assertTrue(summarizer.summarize("The Mountain", agents)["invoked"])
            now[0] = 200.0
            unchanged = summarizer.summarize(
                "The Mountain",
                [
                    agent(id="codex:b", activity={"quietForMs": 2000}),
                    agent(id="codex:a", activity={"quietForMs": 1000}),
                ],
            )
            self.assertEqual(unchanged["outcome"], "skipped_unchanged")
            repositories = [("The Mountain", agents), ("Never attempted", agents)]
            prioritized = header.prioritized_repositories(summarizer, repositories)
            self.assertEqual([repo for _, repo, _ in prioritized], ["Never attempted", "The Mountain"])
            self.assertEqual(len(calls), 1)

    def test_header_summarizer_bounds_failures_and_excludes_automation_rows(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []

            def fail(_prompt):
                calls.append(True)
                raise RuntimeError("invalid model output")

            summarizer = header.HeaderSummarizer(
                pathlib.Path(root), fail, now=lambda: 1_786_290_000.0
            )
            agents = [agent(task="Implement durable task refinement")]
            self.assertEqual(summarizer.summarize("The Mountain", agents)["outcome"], "failed")
            self.assertEqual(summarizer.summarize("The Mountain", agents)["outcome"], "failed")
            self.assertEqual(
                summarizer.summarize("The Mountain", agents)["outcome"],
                "skipped_retry_exhausted",
            )
            self.assertEqual(len(calls), 2)

            snapshot = {
                "programs": [
                    {
                        "name": "The Mountain",
                        "agents": [
                            agent(task="Zulu duplicate"),
                            agent(id="codex:auto", sessionKind="automation"),
                        ],
                    },
                    {
                        "name": "The Mountain",
                        "agents": [
                            agent(task="Alpha duplicate"),
                            agent(id="codex:worker-2"),
                        ],
                    },
                ]
            }
            repositories = header.active_repositories(snapshot)
            self.assertEqual(len(repositories), 1)
            self.assertEqual(
                sorted(item["id"] for item in repositories[0][1]),
                ["codex:worker-1", "codex:worker-2"],
            )
            reversed_snapshot = {"programs": list(reversed(snapshot["programs"]))}
            self.assertEqual(
                header.repo_evidence(repositories[0][1]),
                header.repo_evidence(header.active_repositories(reversed_snapshot)[0][1]),
            )


class AccountingTests(unittest.TestCase):
    def test_cached_and_reasoning_subsets_are_not_double_charged(self):
        estimate = refiner.api_list_price_estimate(
            {
                "inputTokens": 100,
                "cachedInputTokens": 40,
                "cacheWriteTokens": 10,
                "outputTokens": 20,
                "reasoningOutputTokens": 5,
                "totalTokens": 120,
            },
            {
                "input": 2,
                "cacheRead": 0.2,
                "cacheCreation": 2.5,
                "output": 8,
            },
        )
        self.assertAlmostEqual(estimate, (60 * 2 + 40 * 0.2 + 10 * 2.5 + 20 * 8) / 1_000_000)

    def test_history_report_deduplicates_by_session_and_uses_terminal_usage(self):
        with tempfile.TemporaryDirectory() as root:
            sessions = pathlib.Path(root) / "sessions"
            sessions.mkdir()
            session = sessions / "rollout.jsonl"
            session.write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "type": "session_meta",
                                "payload": {"id": "session-1", "timestamp": "2026-08-09T15:00:00Z"},
                            }
                        ),
                        json.dumps(
                            {
                                "type": "turn_context",
                                "payload": {"model": "gpt-5.6-sol"},
                            }
                        ),
                        json.dumps(
                            {
                                "type": "response_item",
                                "payload": {
                                    "type": "message",
                                    "role": "user",
                                    "content": [
                                        {
                                            "type": "input_text",
                                            "text": "You are Task refiner for Ant Hill. Summarize this",
                                        }
                                    ],
                                },
                            }
                        ),
                        json.dumps(
                            {
                                "type": "event_msg",
                                "payload": {
                                    "type": "token_count",
                                    "info": {
                                        "total_token_usage": {
                                            "input_tokens": 100,
                                            "cached_input_tokens": 40,
                                            "cache_write_input_tokens": 10,
                                            "output_tokens": 20,
                                            "reasoning_output_tokens": 5,
                                            "total_tokens": 120,
                                        }
                                    },
                                },
                            }
                        ),
                    ]
                )
            )
            prices = pathlib.Path(root) / "models.json"
            prices.write_text(
                json.dumps(
                    {
                        "pricingVersion": "test-v1",
                        "modelPricingUsdPerMillionTokens": {
                            "gpt-5.6-sol": {
                                "aliases": ["gpt-5.6-sol"],
                                "providers": ["OpenAI API"],
                                "input": 2,
                                "cacheRead": 0.2,
                                "cacheCreation": 2.5,
                                "output": 8,
                            }
                        },
                    }
                )
            )
            report = refiner.history_report(sessions, prices)
            self.assertEqual(report["sessions"], 1)
            self.assertEqual(report["tokens"]["totalTokens"], 120)
            self.assertEqual(report["actualCostUsd"], None)
            self.assertEqual(report["actualCostProvenance"], "unknown")
            self.assertGreater(report["apiListPriceEstimateUsd"], 0)
            self.assertEqual(report["apiListPriceEstimatedSessions"], 1)
            self.assertEqual(
                report["apiListPriceEstimatedFloorUsd"], report["apiListPriceEstimateUsd"]
            )

    def test_venture_ledger_reports_sessions_tokens_cost_floor_and_zero_call_cycles(self):
        with tempfile.TemporaryDirectory() as root:
            ledger = pathlib.Path(root) / "venture-usage.jsonl"
            rows = [
                {
                    "recordType": "invocation",
                    "component": "task-refiner",
                    "model": "gpt-5.6-luna",
                    "outcome": "success",
                    "inputTokens": 100,
                    "cachedInputTokens": 40,
                    "cacheWriteTokens": 0,
                    "outputTokens": 20,
                    "reasoningOutputTokens": 5,
                    "totalTokens": 120,
                    "persistentSessionDelta": 0,
                    "visibleSessionDelta": 0,
                    "costUsd": None,
                    "apiListPriceEstimateUsd": 0.001,
                    "solCounterfactualUsd": 0.02,
                    "estimatedSavingsUsd": 0.019,
                },
                {
                    "recordType": "cycle",
                    "component": "task-refiner",
                    "invoked": 0,
                },
            ]
            ledger.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
            report = refiner.venture_ledger_report(ledger)
            self.assertEqual(report["modelInvocations"], 1)
            self.assertEqual(report["persistentSessionsCreated"], 0)
            self.assertEqual(report["visibleSessionsCreated"], 0)
            self.assertEqual(report["tokens"]["totalTokens"], 120)
            self.assertIsNone(report["actualCostUsd"])
            self.assertEqual(report["apiListPriceEstimateUsd"], 0.001)
            self.assertEqual(report["zeroInvocationCycles"], 1)


class SingletonTests(unittest.TestCase):
    def test_second_process_cannot_acquire_live_owner_lock(self):
        with tempfile.TemporaryDirectory() as root:
            lock_path = pathlib.Path(root) / "refiner.lock"
            owner = refiner.SingletonLock(lock_path)
            self.assertTrue(owner.acquire())
            probe = (
                "import importlib.util,pathlib,sys;"
                f"p=pathlib.Path({str(SCRIPT)!r});"
                "s=importlib.util.spec_from_file_location('probe_refiner',p);"
                "m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);"
                f"lock=m.SingletonLock(pathlib.Path({str(lock_path)!r}));"
                "print('acquired' if lock.acquire() else 'blocked')"
            )
            result = subprocess.run(
                [sys.executable, "-c", probe], capture_output=True, text=True, check=True
            )
            self.assertEqual(result.stdout.strip(), "blocked")
            owner.release()


if __name__ == "__main__":
    unittest.main()

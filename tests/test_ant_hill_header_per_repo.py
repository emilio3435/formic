import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch


sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).parents[1]
RUNTIME_SCRIPT = ROOT / "scripts/ant-hill-summary-runtime.py"
HEADER_SCRIPT = ROOT / "scripts/ant-hill-header-per-repo.py"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


runtime = load_module("ant_hill_summary_runtime_test", RUNTIME_SCRIPT)
header = load_module("ant_hill_header_per_repo_test", HEADER_SCRIPT)


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


def runner(path):
    return runtime.CodexRunner(
        pathlib.Path("/tmp/repo"),
        "http://127.0.0.1:4701/api/snapshot",
        automation_origin=header.PROMPT_VERSION,
        visible_markers=(header.PROMPT_PREFIX, header.AUTOMATION_MARKER),
        component_name="header-summarizer",
        safety_path=path,
    )


class RuntimeTests(unittest.TestCase):
    def test_header_loads_from_summary_runtime_and_task_daemon_is_absent(self):
        self.assertTrue(RUNTIME_SCRIPT.exists())
        self.assertFalse((ROOT / "scripts/ant-hill-task-refine.py").exists())
        self.assertIsNotNone(header.core.CodexRunner)

    def test_header_eligibility_excludes_automation_and_its_own_origin(self):
        self.assertFalse(header.eligible_header_agent(agent(sessionKind="automation")))
        self.assertFalse(
            header.eligible_header_agent(agent(task=f"{header.PROMPT_PREFIX} summarize"))
        )
        self.assertFalse(
            header.eligible_header_agent(agent(task=f"{header.AUTOMATION_MARKER} summarize"))
        )
        self.assertTrue(header.eligible_header_agent(agent()))

    def test_launcher_is_direct_ephemeral_luna_low_and_reads_stdin(self):
        command = runtime.build_codex_command(
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
                        "item": {"type": "agent_message", "text": "One fleet summary"},
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
        parsed = runtime.parse_codex_events(stdout)
        self.assertEqual(parsed["threadId"], "ephemeral-1")
        self.assertEqual(parsed["usage"]["cachedInputTokens"], 40)
        self.assertEqual(parsed["usage"]["reasoningOutputTokens"], 5)
        self.assertEqual(parsed["usage"]["totalTokens"], 120)

    def test_runner_uses_header_origin_and_header_safety_names(self):
        with tempfile.TemporaryDirectory() as root:
            safety_path = pathlib.Path(root) / runtime.SAFETY_CIRCUIT_FILENAME

            class FinishedProcess:
                pid = 4321
                returncode = 0

                @staticmethod
                def poll():
                    return 0

                @staticmethod
                def communicate(_prompt=None, timeout=None):
                    return (
                        "\n".join(
                            [
                                json.dumps({"type": "thread.started", "thread_id": "e1"}),
                                json.dumps(
                                    {
                                        "type": "item.completed",
                                        "item": {"type": "agent_message", "text": "Fleet summary"},
                                    }
                                ),
                                json.dumps({"type": "turn.completed", "usage": {"input_tokens": 1, "output_tokens": 1}}),
                            ]
                        ),
                        "",
                    )

            with patch.object(
                runtime, "persistent_codex_sessions", side_effect=[set(), set()]
            ), patch.object(
                runtime, "visible_automation_count", side_effect=[0, 0]
            ), patch.object(
                runtime.subprocess, "Popen", return_value=FinishedProcess()
            ) as popen:
                result = runner(safety_path)("prompt")
            self.assertEqual(result["persistentSessionDelta"], 0)
            environment = popen.call_args.kwargs["env"]
            self.assertEqual(environment["ANTHILL_AUTOMATION_ORIGIN"], header.PROMPT_VERSION)
            self.assertNotIn("task-refiner", json.dumps(environment))
            self.assertEqual(safety_path.name, ".header-summarizer-safety.json")

    def test_unknown_baseline_fails_closed_before_starting_codex(self):
        with tempfile.TemporaryDirectory() as root:
            safety_path = pathlib.Path(root) / runtime.SAFETY_CIRCUIT_FILENAME
            with patch.object(runtime, "persistent_codex_sessions", return_value=None), patch.object(
                runtime, "visible_automation_count", return_value=0
            ), patch.object(runtime.subprocess, "Popen") as popen:
                with self.assertRaises(runtime.IsolationViolation):
                    runner(safety_path)("prompt")
            popen.assert_not_called()
            self.assertTrue(runtime.safety_circuit_open(safety_path))


class HeaderSummarizerTests(unittest.TestCase):
    def test_shared_safety_circuit_blocks_a_second_invocation(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []

            def leaked(_prompt):
                calls.append(True)
                return {
                    "summary": "The Mountain: active agents are shipping the header. Review the one open blocker next.",
                    "usage": {},
                    "persistentSessionDelta": 1,
                    "visibleSessionDelta": 1,
                }

            summarizer = header.HeaderSummarizer(pathlib.Path(root), leaked)
            first = summarizer.summarize("The Mountain", [agent()])
            second = summarizer.summarize("The Mountain", [agent(task="Changed evidence")])
            self.assertEqual(first["outcome"], "isolation_violation")
            self.assertEqual(second["outcome"], "skipped_circuit_open")
            self.assertEqual(len(calls), 1)

    def test_changed_evidence_invokes_once_and_disabled_mode_never_invokes(self):
        self.assertFalse(header.header_model_enabled({}))
        self.assertTrue(header.header_model_enabled({"ANT_HILL_HEADER_SUMMARIZER_ENABLED": "1"}))
        with tempfile.TemporaryDirectory() as root:
            calls = []

            def run(prompt):
                calls.append(prompt)
                return {
                    "summary": "The Mountain: active agents are shipping the header. No operator blocker is currently reported.",
                    "threadId": f"header-{len(calls)}",
                    "usage": {"inputTokens": 100, "cachedInputTokens": 40, "cacheWriteTokens": 0, "outputTokens": 20, "totalTokens": 120},
                    "persistentSessionDelta": 0,
                    "visibleSessionDelta": 0,
                }

            summarizer = header.HeaderSummarizer(pathlib.Path(root), run)
            agents = [agent()]
            self.assertTrue(summarizer.summarize("The Mountain", agents)["invoked"])
            self.assertEqual(summarizer.summarize("The Mountain", agents)["outcome"], "skipped_unchanged")
            self.assertTrue(
                summarizer.summarize("The Mountain", [agent(task="Changed evidence")])["invoked"]
            )
            self.assertEqual(len(calls), 2)

            disabled = header.HeaderSummarizer(
                pathlib.Path(root) / "disabled", lambda _prompt: self.fail("invoked"), model_enabled=False
            )
            skipped = disabled.summarize("The Mountain", agents)
            self.assertEqual(skipped["outcome"], "skipped_disabled")
            self.assertFalse(skipped["invoked"])

    def test_prompts_are_directional_and_header_specific(self):
        repo_prompt = header.build_prompt("Home", header.repo_evidence([agent()]))
        fleet_prompt = header.build_fleet_prompt(
            [{"repo": "Home", "signal": "needs-you", "blocker": "input requested", "summary": "Home: review the open input request"}]
        )
        for prompt in (repo_prompt, fleet_prompt):
            self.assertIn("Goal:", prompt)
            self.assertIn("Success means:", prompt)
            self.assertIn("Stop when:", prompt)
            self.assertIn(header.AUTOMATION_MARKER, prompt)
            self.assertNotIn("task-refiner", prompt)
        self.assertIn("priority brief", fleet_prompt)

    def test_header_validator_salvages_prefix_and_collapses_restatement(self):
        concise = "Home: active agents are shipping the header and no operator blockers are currently reported"
        self.assertEqual(header.validate_header_summary("Home", concise), concise)
        salvaged = header.validate_header_summary("Home", concise.replace("Home:", "Other:"))
        self.assertTrue(salvaged.startswith("Home:"))
        repeated = header.validate_header_summary(
            "Home", "Home: Home has an active handoff and a waiting assessment on incomplete steps"
        )
        self.assertNotRegex(repeated, r"^Home:\s*Home\b")

    def test_wire_envelope_stays_parseable_under_the_cap(self):
        cards = [
            {
                "repo": f"repository-{index}",
                "summary": f"repository-{index}: " + "active evidence and next action " * 8,
                "blocker": "question pending from integration owner",
                "signal": "needs-you",
            }
            for index in range(6)
        ]
        wire = header.build_wire_envelope(cards, max_chars=780)
        envelope = json.loads(wire)
        self.assertLessEqual(len(wire), 780)
        self.assertEqual(envelope["v"], 3)
        self.assertEqual(len(envelope["repos"]) + envelope.get("omitted", 0), 6)

    def test_failure_retries_are_bounded_and_automation_rows_are_excluded(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []

            def fail(_prompt):
                calls.append(True)
                raise RuntimeError("invalid model output")

            summarizer = header.HeaderSummarizer(pathlib.Path(root), fail, now=lambda: 1_786_290_000.0)
            agents = [agent()]
            self.assertEqual(summarizer.summarize("The Mountain", agents)["outcome"], "failed")
            self.assertEqual(summarizer.summarize("The Mountain", agents)["outcome"], "failed")
            self.assertEqual(summarizer.summarize("The Mountain", agents)["outcome"], "skipped_retry_exhausted")
            self.assertEqual(len(calls), 2)

            snapshot = {
                "programs": [
                    {"name": "The Mountain", "agents": [agent(), agent(id="codex:auto", sessionKind="automation")]},
                    {"name": "The Mountain", "agents": [agent(id="codex:worker-2")]},
                ]
            }
            repositories = header.active_repositories(snapshot)
            self.assertEqual(
                sorted(item["id"] for item in repositories[0][1]),
                ["codex:worker-1", "codex:worker-2"],
            )

    def test_active_repositories_keeps_only_the_last_hour(self):
        now_ms = 1_786_290_000_000.0
        recent = datetime.fromtimestamp((now_ms - 10 * 60_000) / 1000.0, timezone.utc).isoformat()
        stale = datetime.fromtimestamp((now_ms - 5 * 60 * 60_000) / 1000.0, timezone.utc).isoformat()
        snapshot = {
            "programs": [
                {"name": "Home", "agents": [agent(id="codex:hot", updatedAt=recent), agent(id="codex:stale", updatedAt=stale)]}
            ]
        }
        repos = header.active_repositories(snapshot, now_ms=now_ms)
        self.assertEqual([item["id"] for item in repos[0][1]], ["codex:hot"])


class AccountingAndLockTests(unittest.TestCase):
    def test_cached_and_reasoning_subsets_are_not_double_charged(self):
        estimate = runtime.api_list_price_estimate(
            {"inputTokens": 100, "cachedInputTokens": 40, "cacheWriteTokens": 10, "outputTokens": 20, "reasoningOutputTokens": 5, "totalTokens": 120},
            {"input": 2, "cacheRead": 0.2, "cacheCreation": 2.5, "output": 8},
        )
        self.assertAlmostEqual(estimate, (60 * 2 + 40 * 0.2 + 10 * 2.5 + 20 * 8) / 1_000_000)

    def test_second_process_cannot_acquire_live_header_lock(self):
        with tempfile.TemporaryDirectory() as root:
            lock_path = pathlib.Path(root) / "header.lock"
            owner = runtime.SingletonLock(lock_path, prompt_version=header.PROMPT_VERSION)
            self.assertTrue(owner.acquire())
            self.assertEqual(json.loads(lock_path.read_text())["promptVersion"], header.PROMPT_VERSION)
            probe = (
                "import importlib.util,pathlib,sys;"
                f"p=pathlib.Path({str(RUNTIME_SCRIPT)!r});"
                "s=importlib.util.spec_from_file_location('probe_runtime',p);"
                "m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);"
                f"lock=m.SingletonLock(pathlib.Path({str(lock_path)!r}),prompt_version='probe');"
                "print('acquired' if lock.acquire() else 'blocked')"
            )
            result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), "blocked")
            owner.release()


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Shared deterministic runtime for Ant Hill's header summarizer."""

from __future__ import annotations

import fcntl
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any


MODEL = "gpt-5.6-luna"
REASONING_EFFORT = "low"
MAX_ATTEMPTS_PER_FINGERPRINT = 2
DEFAULT_TIMEOUT_SECONDS = 60
SAFETY_CIRCUIT_FILENAME = ".header-summarizer-safety.json"


class IsolationViolation(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        result: dict[str, Any] | None = None,
        persistent_session_delta: int | None = None,
        visible_session_delta: int | None = None,
    ):
        super().__init__(message)
        self.result = result
        self.persistent_session_delta = persistent_session_delta
        self.visible_session_delta = visible_session_delta


class SafetyCircuitOpen(RuntimeError):
    pass


def utc_iso(timestamp: float | None = None) -> str:
    return datetime.fromtimestamp(timestamp or time.time(), timezone.utc).isoformat()


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def atomic_write_text(path: pathlib.Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def safety_circuit_path(summary_root: pathlib.Path) -> pathlib.Path:
    return summary_root / SAFETY_CIRCUIT_FILENAME


def safety_circuit_open(path: pathlib.Path) -> bool:
    if not path.exists():
        return False
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return True
    return value.get("open") is not False if isinstance(value, dict) else True


def trip_safety_circuit(path: pathlib.Path, details: dict[str, Any]) -> None:
    if safety_circuit_open(path):
        return
    atomic_write_text(
        path,
        json.dumps({"open": True, "trippedAt": utc_iso(), **details}, sort_keys=True),
    )


def _is_zero_delta(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0


def isolation_deltas_safe(result: dict[str, Any] | None) -> bool:
    return bool(result) and _is_zero_delta(result.get("persistentSessionDelta")) and _is_zero_delta(
        result.get("visibleSessionDelta")
    )


def append_jsonl(path: pathlib.Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    descriptor = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, line)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class SingletonLock:
    """A kernel-owned singleton; a stale file is harmless after owner exit."""

    def __init__(self, path: pathlib.Path, *, prompt_version: str):
        self.path = path
        self.prompt_version = prompt_version
        self.handle: Any = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.close()
            return False
        handle.seek(0)
        handle.truncate()
        json.dump(
            {
                "pid": os.getpid(),
                "startedAt": utc_iso(),
                "command": sys.argv,
                "promptVersion": self.prompt_version,
            },
            handle,
            sort_keys=True,
        )
        handle.flush()
        os.fsync(handle.fileno())
        self.handle = handle
        return True

    def release(self) -> None:
        if not self.handle:
            return
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()
        self.handle = None

    def __enter__(self) -> "SingletonLock":
        if not self.acquire():
            raise RuntimeError("header summarizer singleton is already owned")
        return self

    def __exit__(self, *_args: Any) -> None:
        self.release()


def build_codex_command(repo_root: pathlib.Path, codex_bin: str = "codex") -> list[str]:
    return [
        codex_bin,
        "exec",
        "--sandbox",
        "read-only",
        "--ephemeral",
        "--json",
        "--model",
        MODEL,
        "-c",
        f"model_reasoning_effort={REASONING_EFFORT}",
        "--cd",
        str(repo_root),
        "-",
    ]


def _usage_value(usage: dict[str, Any], snake: str, camel: str) -> int | None:
    value = usage.get(snake, usage.get(camel))
    return int(value) if isinstance(value, (int, float)) and value >= 0 else None


def normalized_usage(usage: dict[str, Any] | None) -> dict[str, int | None]:
    usage = usage or {}
    normalized = {
        "inputTokens": _usage_value(usage, "input_tokens", "inputTokens"),
        "cachedInputTokens": _usage_value(usage, "cached_input_tokens", "cachedInputTokens"),
        "cacheWriteTokens": _usage_value(usage, "cache_write_input_tokens", "cacheWriteTokens"),
        "outputTokens": _usage_value(usage, "output_tokens", "outputTokens"),
        "reasoningOutputTokens": _usage_value(usage, "reasoning_output_tokens", "reasoningOutputTokens"),
        "totalTokens": _usage_value(usage, "total_tokens", "totalTokens"),
    }
    if normalized["totalTokens"] is None:
        input_tokens = normalized["inputTokens"]
        output_tokens = normalized["outputTokens"]
        if input_tokens is not None and output_tokens is not None:
            normalized["totalTokens"] = input_tokens + output_tokens
    return normalized


def parse_codex_events(stdout: str) -> dict[str, Any]:
    summary = ""
    thread_id: str | None = None
    usage: dict[str, Any] | None = None
    for raw_line in stdout.splitlines():
        if not raw_line.strip():
            continue
        try:
            event = json.loads(raw_line)
        except json.JSONDecodeError as error:
            raise ValueError(f"Codex emitted non-JSON output: {raw_line[:160]}") from error
        if event.get("type") == "thread.started":
            thread_id = normalize_text(event.get("thread_id")) or None
        if event.get("type") == "item.completed":
            item = event.get("item") or {}
            if item.get("type") == "agent_message":
                summary = normalize_text(item.get("text"))
        if event.get("type") == "turn.completed":
            usage = event.get("usage") if isinstance(event.get("usage"), dict) else None
    if not summary:
        raise ValueError("Codex JSON stream did not contain a final agent message")
    if usage is None:
        raise ValueError("Codex JSON stream did not contain terminal token usage")
    return {"summary": summary, "threadId": thread_id, "usage": normalized_usage(usage)}


def api_list_price_estimate(
    usage: dict[str, Any], price: dict[str, Any] | None
) -> float | None:
    if not price:
        return None
    normalized = normalized_usage(usage)
    required = (
        normalized["inputTokens"],
        normalized["outputTokens"],
        normalized["cachedInputTokens"],
        normalized["cacheWriteTokens"],
    )
    if any(value is None for value in required):
        return None
    input_tokens = int(normalized["inputTokens"] or 0)
    cached_tokens = min(input_tokens, int(normalized["cachedInputTokens"] or 0))
    uncached_tokens = input_tokens - cached_tokens
    output_tokens = int(normalized["outputTokens"] or 0)
    cache_write_tokens = int(normalized["cacheWriteTokens"] or 0)
    return (
        uncached_tokens * float(price["input"])
        + cached_tokens * float(price["cacheRead"])
        + cache_write_tokens * float(price["cacheCreation"])
        + output_tokens * float(price["output"])
    ) / 1_000_000


def load_pricing_config(path: pathlib.Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"pricingVersion": "unavailable", "modelPricingUsdPerMillionTokens": {}}
    prices = value.get("modelPricingUsdPerMillionTokens")
    if not isinstance(prices, dict):
        prices = {}
    return {
        "pricingVersion": normalize_text(value.get("pricingVersion")) or "unavailable",
        "modelPricingUsdPerMillionTokens": prices,
    }


def model_price(model: str, config: dict[str, Any]) -> dict[str, Any] | None:
    canonical = model.split("/")[-1].strip().lower().replace("_", " ").replace(" ", "-")
    for price in config.get("modelPricingUsdPerMillionTokens", {}).values():
        if not isinstance(price, dict):
            continue
        aliases = price.get("aliases") or []
        if any(canonical == alias or canonical.startswith(f"{alias}-") for alias in aliases):
            return price
    return None


def fetch_json(url: str, timeout: float = 5) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        value = json.load(response)
    if not isinstance(value, dict):
        raise ValueError(f"expected object from {url}")
    return value


def _matches_visible_origin(agent: dict[str, Any], markers: tuple[str, ...]) -> bool:
    evidence = "\n".join(
        normalize_text(agent.get(field))
        for field in ("task", "lastHumanMessage", "lastUserMessage", "statusReason")
    )
    return any(marker in evidence for marker in markers)


def visible_automation_count(snapshot_url: str, markers: tuple[str, ...]) -> int | None:
    try:
        snapshot = fetch_json(snapshot_url)
    except Exception:
        return None
    return sum(
        1
        for program in snapshot.get("programs", [])
        if isinstance(program, dict)
        for agent in program.get("agents", [])
        if isinstance(agent, dict) and _matches_visible_origin(agent, markers)
    )


def persistent_codex_sessions() -> set[str] | None:
    root = pathlib.Path.home() / ".codex/sessions"
    try:
        return {str(path) for path in root.rglob("*.jsonl")}
    except OSError:
        return None


class CodexRunner:
    def __init__(
        self,
        repo_root: pathlib.Path,
        snapshot_url: str,
        *,
        automation_origin: str,
        visible_markers: tuple[str, ...],
        component_name: str,
        codex_bin: str = "codex",
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        safety_path: pathlib.Path | None = None,
    ):
        self.command = build_codex_command(repo_root, codex_bin)
        self.snapshot_url = snapshot_url
        self.automation_origin = automation_origin
        self.visible_markers = visible_markers
        self.component_name = component_name
        self.timeout_seconds = timeout_seconds
        self.safety_path = safety_path or safety_circuit_path(repo_root / "data/header-summaries")
        self.process: subprocess.Popen[str] | None = None

    def terminate(self) -> None:
        process = self.process
        if process is None or process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    def __call__(self, prompt: str) -> dict[str, Any]:
        if safety_circuit_open(self.safety_path):
            raise SafetyCircuitOpen(f"{self.component_name} safety circuit is open: {self.safety_path}")
        before_sessions = persistent_codex_sessions()
        before_visible = visible_automation_count(self.snapshot_url, self.visible_markers)
        if before_sessions is None or before_visible is None:
            trip_safety_circuit(
                self.safety_path,
                {
                    "reason": f"{self.component_name} isolation baseline unavailable",
                    "persistentSessionDelta": None,
                    "visibleSessionDelta": None,
                },
            )
            raise IsolationViolation(
                f"{self.component_name} isolation baseline unavailable",
                persistent_session_delta=None,
                visible_session_delta=None,
            )
        environment = os.environ.copy()
        environment["ANTHILL_SESSION_KIND"] = "automation"
        environment["ANTHILL_AUTOMATION_ORIGIN"] = self.automation_origin
        process = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=environment,
            start_new_session=True,
        )
        self.process = process
        stdout = ""
        stderr = ""
        failure: Exception | None = None
        result: dict[str, Any] | None = None
        try:
            try:
                stdout, stderr = process.communicate(prompt, timeout=self.timeout_seconds)
            except subprocess.TimeoutExpired as error:
                self.terminate()
                try:
                    process.communicate(timeout=2)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.communicate()
                failure = TimeoutError(
                    f"Codex {self.component_name} exceeded {self.timeout_seconds}s"
                )
                failure.__cause__ = error
            if failure is None and process.returncode != 0:
                failure = RuntimeError(
                    f"Codex {self.component_name} exited {process.returncode}: {normalize_text(stderr)[:300]}"
                )
            if failure is None:
                try:
                    result = parse_codex_events(stdout)
                except Exception as error:
                    failure = error
        except Exception as error:
            failure = error
        finally:
            self.process = None
        after_sessions = persistent_codex_sessions()
        after_visible = visible_automation_count(self.snapshot_url, self.visible_markers)
        persistent_delta = (
            len(after_sessions - before_sessions)
            if before_sessions is not None and after_sessions is not None
            else None
        )
        visible_delta = (
            after_visible - before_visible
            if before_visible is not None and after_visible is not None
            else None
        )
        if result is not None:
            result["persistentSessionDelta"] = persistent_delta
            result["visibleSessionDelta"] = visible_delta
        if not _is_zero_delta(persistent_delta) or not _is_zero_delta(visible_delta):
            trip_safety_circuit(
                self.safety_path,
                {
                    "reason": f"{self.component_name} isolation violated or unverified",
                    "persistentSessionDelta": persistent_delta,
                    "visibleSessionDelta": visible_delta,
                    "ephemeralThreadId": (result or {}).get("threadId"),
                },
            )
            raise IsolationViolation(
                f"{self.component_name} isolation violated or unverified",
                result=result,
                persistent_session_delta=persistent_delta,
                visible_session_delta=visible_delta,
            ) from failure
        if failure is not None:
            raise failure
        assert result is not None
        return result


def install_stop_handlers(runner: CodexRunner) -> None:
    def stop(signum: int, _frame: Any) -> None:
        runner.terminate()
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

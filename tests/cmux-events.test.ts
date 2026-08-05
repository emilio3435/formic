import { describe, expect, spyOn, test } from "bun:test";
import {
  CmuxEventsSupervisor,
  cmuxEventsCommand,
  parseCmuxEventLine,
  type CmuxEventsChild,
  type ScheduleCmuxEventsRestart,
} from "../src/server/cmux-events";
import { HubState } from "../src/server/state";
import type { ArchiveStore, CommandRunner } from "../src/server/types";

const encoder = new TextEncoder();

function controlledChild(): {
  child: CmuxEventsChild;
  write(text: string): void;
  finish(exitCode: number): void;
  signals: string[];
} {
  let stdout!: ReadableStreamDefaultController<Uint8Array>;
  let resolveExit!: (exitCode: number) => void;
  let finished = false;
  const exited = new Promise<number>((resolve) => { resolveExit = resolve; });
  const signals: string[] = [];
  const finish = (exitCode: number): void => {
    if (finished) return;
    finished = true;
    stdout.close();
    resolveExit(exitCode);
  };
  return {
    child: {
      stdout: new ReadableStream({ start(controller) { stdout = controller; } }),
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      exited,
      kill: (signal) => {
        signals.push(signal);
        finish(143);
      },
    },
    write: (text) => stdout.enqueue(encoder.encode(text)),
    finish,
    signals,
  };
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let turn = 0; turn < 100; turn += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  throw lastError;
}

describe("cmux event protocol", () => {
  test("builds the exact reconnecting agent/workspace cursor command", () => {
    expect(cmuxEventsCommand("/opt/cmux/bin/cmux")).toEqual([
      "/opt/cmux/bin/cmux",
      "events",
      "--cursor-file",
      "~/.anthill/events.cursor",
      "--reconnect",
      "--category",
      "agent",
      "--category",
      "workspace",
    ]);
  });

  test("parses canonical ack, event, and heartbeat frames without guessing fields", () => {
    expect(parseCmuxEventLine(JSON.stringify({
      type: "ack",
      boot_id: "boot-a",
      resume: { gap: true },
    }))).toEqual({ type: "ack", bootId: "boot-a", resumeGap: true });
    expect(parseCmuxEventLine(JSON.stringify({
      type: "event",
      boot_id: "boot-a",
      seq: 17,
      category: "agent",
    }))).toEqual({ type: "event", bootId: "boot-a", sequence: 17, category: "agent" });
    expect(parseCmuxEventLine(JSON.stringify({
      type: "heartbeat",
      boot_id: "boot-a",
      latest_seq: 17,
    }))).toEqual({ type: "heartbeat", bootId: "boot-a" });
    expect(() => parseCmuxEventLine(JSON.stringify({
      type: "error",
      error: "slow_consumer",
    }))).toThrow("slow_consumer");
    expect(parseCmuxEventLine(JSON.stringify({ type: "future-frame" }))).toBeUndefined();
    expect(() => parseCmuxEventLine("not-json")).toThrow("invalid JSON");
    expect(() => parseCmuxEventLine(JSON.stringify({
      type: "event",
      boot_id: "boot-a",
      seq: "17",
      category: "agent",
    }))).toThrow("numeric seq");
  });
});

describe("cmux event child supervision", () => {
  test("decodes fragmented NDJSON and surfaces malformed frames without losing later events", async () => {
    const process = controlledChild();
    const frames: unknown[] = [];
    const errors: string[] = [];
    const supervisor = new CmuxEventsSupervisor({
      command: ["cmux", "events"],
      spawn: () => process.child,
      onFrame: (frame) => frames.push(frame),
      onError: (error) => errors.push(error.message),
    });

    supervisor.start();
    process.write('{"type":"ack","boot_id":"boo');
    process.write('t-a","resume":{"gap":false}}\nnot-json\n');
    process.write('{"type":"event","boot_id":"boot-a","seq":1,"category":"workspace"}\n');

    await eventually(() => expect(frames).toEqual([
      { type: "ack", bootId: "boot-a", resumeGap: false },
      { type: "event", bootId: "boot-a", sequence: 1, category: "workspace" },
    ]));
    expect(errors).toEqual([expect.stringContaining("invalid JSON")]);
    supervisor.stop();
  });

  test("restarts an exited child and stop terminates the replacement without another spawn", async () => {
    const first = controlledChild();
    const second = controlledChild();
    const children = [first, second];
    const commands: string[][] = [];
    let scheduledRestart: (() => void) | undefined;
    let restartCancelled = false;
    const scheduleRestart: ScheduleCmuxEventsRestart = (restart, delayMs) => {
      expect(delayMs).toBe(1_000);
      scheduledRestart = restart;
      return { cancel: () => { restartCancelled = true; } };
    };
    const supervisor = new CmuxEventsSupervisor({
      command: ["cmux", "events"],
      spawn: (command) => {
        commands.push([...command]);
        const next = children[commands.length - 1];
        if (!next) throw new Error("unexpected extra spawn");
        return next.child;
      },
      scheduleRestart,
      onFrame: () => {},
      onError: () => {},
    });

    supervisor.start();
    supervisor.start();
    expect(commands).toHaveLength(1);
    first.finish(9);
    await eventually(() => expect(scheduledRestart).toBeFunction());
    scheduledRestart?.();
    await eventually(() => expect(commands).toHaveLength(2));

    supervisor.stop();
    expect(second.signals).toEqual(["SIGTERM"]);
    expect(restartCancelled).toBe(false);
    scheduledRestart?.();
    expect(commands).toHaveLength(2);
  });
});

describe("HubState cmux event acceleration", () => {
  test("uses agent deltas for source refreshes and snapshots on workspace, gap, or boot changes", async () => {
    const process = controlledChild();
    const commands: string[][] = [];
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const state = new HubState(runner, archiveStore, [], { cmuxExecutable: "/opt/cmux/bin/cmux" });
    const refresh = spyOn(state, "refresh").mockImplementation(async () => state.get());

    state.startCmuxEvents({
      cursorFile: "/tmp/anthill-test-events.cursor",
      spawn: (command) => {
        commands.push([...command]);
        return process.child;
      },
    });
    state.startCmuxEvents();
    expect(commands).toEqual([[
      "/opt/cmux/bin/cmux",
      "events",
      "--cursor-file",
      "/tmp/anthill-test-events.cursor",
      "--reconnect",
      "--category",
      "agent",
      "--category",
      "workspace",
    ]]);

    process.write('{"type":"ack","boot_id":"boot-a","resume":{"gap":false}}\n');
    await eventually(() => expect(refresh).toHaveBeenCalledTimes(0));
    process.write('{"type":"event","boot_id":"boot-a","seq":1,"category":"agent"}\n');
    await eventually(() => expect(refresh).toHaveBeenCalledTimes(1));
    process.write('{"type":"event","boot_id":"boot-a","seq":2,"category":"workspace"}\n');
    await eventually(() => expect(refresh).toHaveBeenCalledTimes(2));
    process.write('{"type":"heartbeat","boot_id":"boot-b"}\n');
    await eventually(() => expect(refresh).toHaveBeenCalledTimes(3));
    process.write('{"type":"ack","boot_id":"boot-b","resume":{"gap":true}}\n');
    await eventually(() => expect(refresh).toHaveBeenCalledTimes(4));

    expect(refresh.mock.calls.map(([options]) => options)).toEqual([
      {},
      { cmux: true },
      { cmux: true },
      { cmux: true },
    ]);
    state.stopCmuxEvents();
    expect(process.signals).toEqual(["SIGTERM"]);
    refresh.mockRestore();
  });
});

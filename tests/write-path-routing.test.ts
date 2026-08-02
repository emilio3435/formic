import { describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import { MemoryAttentionStore, parseCmuxNotifications } from "../src/server/cmux";
import type { AgentSnapshot, ControlAction } from "../src/shared/types";
import type { ArchiveStore, CommandResult, CommandRunner } from "../src/server/types";

/* The write path: what the cockpit DOES, rather than what it computes.

   Everything else in this suite reads. Focus, Send, Interrupt, Archive and
   Acknowledge are the six things that touch a real agent, and they route
   through identity resolution, which is the most defect-dense code here — the
   false-died bug, the subagents bug and the quarantine gate all lived in it.

   ONE property, and it is the only one that can cost an operator something
   irreversible:

     An action reaches the agent it names, or it refuses.
     It never reaches a different one.

   Fail-closed is the house rule for identity, so the second half is pinned as
   hard as the first: a route the server cannot PROVE is a route it does not
   take. An instruction delivered to the wrong terminal is worse than an
   instruction not delivered, because the operator believes it landed and the
   agent that received it was never asked.

   Everything here is a fixture. No live lane is touched: the runner records the
   argv it was handed and returns success without executing anything. */

const OK: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
const BUSY: CommandResult = { exitCode: 1, stdout: "", stderr: "busy", timedOut: false };

/** Records every command instead of running it, so argv can be inspected.
    `results` supplies per-call outcomes; the last one repeats. */
class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  private call = 0;
  constructor(private readonly results: CommandResult[] = [OK]) {}
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return this.results[Math.min(this.call++, this.results.length - 1)]!;
  }
  /** Every argument of every command, flattened — for "did B's id appear anywhere". */
  get argv(): string {
    return this.commands.flat().join(" ");
  }
}

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const ACTIONS: readonly ControlAction[] = ["focus", "instruct", "interrupt", "archive"];

/* Two agents on two different panes. Every routing test below acts on ALPHA and
   asserts BRAVO's surface never appears, which is the failure that costs
   something: not a refusal, but a delivery to the wrong terminal. */
const ALPHA_SURFACE = "SURFACE-ALPHA";
const BRAVO_SURFACE = "SURFACE-BRAVO";

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:alpha",
    provider: "codex",
    sourceSessionId: "alpha",
    displayName: "Alpha",
    programId: "p1",
    status: "running",
    statusReason: "Fixture activity is recent.",
    lastHumanMessage: null,
    updatedAt: "2026-08-02T10:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { surfaceId: ALPHA_SURFACE, resolution: "exact" },
    controls: ACTIONS.map((action) => ({ action, enabled: true })),
    ...overrides,
  } as AgentSnapshot;
}

const run = (
  subject: AgentSnapshot,
  action: ControlAction,
  runner: RecordingRunner,
  instruction?: string,
) => executeControl(
  { agentId: subject.id, action, ...(instruction ? { instruction } : {}) },
  subject,
  { runner, archiveStore, cmuxExecutable: "cmux" },
);

describe("an action reaches the agent it names", () => {
  test.each(["focus", "interrupt"] as const)("%s addresses only the resolved surface", async (action) => {
    const runner = new RecordingRunner();
    await run(agent(), action, runner);

    expect(runner.commands.length).toBeGreaterThan(0);
    expect(runner.argv).toContain(ALPHA_SURFACE);
    expect(runner.argv).not.toContain(BRAVO_SURFACE);
  });

  test("an instruction and its Enter go to the same surface", async () => {
    /* Send is two commands — the text, then the key that submits it. If they
       could disagree, half an instruction would land on one terminal and the
       keystroke that runs it on another. Every command in the sequence is
       checked, not just the first. */
    const runner = new RecordingRunner();
    await run(agent(), "instruct", runner, "run the tests");

    expect(runner.commands.length).toBeGreaterThanOrEqual(2);
    for (const command of runner.commands) {
      expect(command.join(" ")).toContain(ALPHA_SURFACE);
      expect(command.join(" ")).not.toContain(BRAVO_SURFACE);
    }
  });

  test("the instruction text reaches the surface intact", async () => {
    const runner = new RecordingRunner();
    await run(agent(), "instruct", runner, "run the tests");

    expect(runner.argv).toContain("run the tests");
  });

  test("a retried submit is retried against the same surface", async () => {
    /* The submit is retried once when the first attempt fails. A retry that
       re-resolved the target could deliver the keystroke somewhere else, the
       text having already landed on the original.

       Only the SUBMIT retries: the text succeeds, the first Enter fails, the
       second succeeds. An earlier draft failed the text instead and saw one
       command, because a failed send_text returns before any Enter is sent —
       the test was exercising the wrong half of the sequence. */
    const runner = new RecordingRunner([OK, BUSY, OK]);
    const result = await run(agent(), "instruct", runner, "run the tests");

    expect(runner.commands).toHaveLength(3);
    expect(result.response.ok).toBe(true);
    for (const command of runner.commands) {
      expect(command.join(" ")).toContain(ALPHA_SURFACE);
      expect(command.join(" ")).not.toContain(BRAVO_SURFACE);
    }
  });

  test("a text that never lands is not followed by a submit", async () => {
    /* The other half of the same sequence. If the text failed and Enter went
       anyway, the agent's prompt would run whatever was already on it. */
    const runner = new RecordingRunner([BUSY]);
    const result = await run(agent(), "instruct", runner, "run the tests");

    expect(result.response.ok).toBe(false);
    expect(runner.commands).toHaveLength(1);
    expect(runner.argv).not.toContain("Enter");
  });

  test("the response names the agent that was acted on", async () => {
    // The operator's record of what happened has to match what was sent.
    const runner = new RecordingRunner();
    const result = await run(agent(), "focus", runner);

    expect(result.response.ok).toBe(true);
    expect(result.response.agentId).toBe("codex:alpha");
  });
});

describe("a route it cannot prove is a route it does not take", () => {
  const unprovable: [string, Partial<AgentSnapshot>][] = [
    ["an ambiguous target", { target: { resolution: "ambiguous", reason: "Two surfaces matched." } }],
    ["no target at all", { target: { resolution: "missing" } }],
    ["a resolution with no surface id", { target: { resolution: "exact" } }],
    /* An ambiguous resolution that DOES carry a surface id. The gate has to
       read the resolution, not merely check that an id is present — a surface
       chosen from several candidates is a guess, and a guess is exactly what
       fail-closed refuses. */
    ["an ambiguous target that still names a surface", { target: { surfaceId: ALPHA_SURFACE, resolution: "ambiguous" } }],
  ];

  test.each(unprovable)("%s refuses focus and sends nothing", async (_label, overrides) => {
    /* Fail-closed. The refusal matters less than the silence beside it: a
       server that answered 409 and shelled out anyway would have routed the
       action and then reported that it had not. */
    const runner = new RecordingRunner();
    const result = await run(agent(overrides), "focus", runner);

    expect(result.response.ok).toBe(false);
    expect(result.response.error?.code).toBe("UNSAFE_TARGET");
    expect(runner.commands).toEqual([]);
  });

  test.each(unprovable)("%s refuses an instruction and sends nothing", async (_label, overrides) => {
    // Send is the expensive one: an instruction delivered to an unproven
    // target is the failure this whole gate exists for.
    const runner = new RecordingRunner();
    const result = await run(agent(overrides), "instruct", runner, "deploy to production");

    expect(result.response.ok).toBe(false);
    expect(runner.commands).toEqual([]);
    expect(runner.argv).not.toContain("deploy to production");
  });

  test("a proven target is not refused, so the gate is a gate and not a wall", () => {
    /* The control. Every refusal above would also hold on a build that refused
       everything, which fails the property from the other side: an action that
       never reaches the agent it names is equally a broken cockpit. */
    const runner = new RecordingRunner();
    return run(agent(), "focus", runner).then((result) => {
      expect(result.response.ok).toBe(true);
      expect(runner.commands.length).toBeGreaterThan(0);
    });
  });

  test("a request naming a different agent cannot borrow this one's proven route", async () => {
    /* Identity is checked before the target is used. Without this, a request
       for BRAVO handed ALPHA's snapshot would execute against ALPHA's surface
       and report success for BRAVO — the exact shape of reaching a different
       agent. */
    const runner = new RecordingRunner();
    const result = await executeControl(
      { agentId: "codex:bravo", action: "focus" },
      agent(),
      { runner, archiveStore, cmuxExecutable: "cmux" },
    );

    expect(result.response.ok).toBe(false);
    expect(result.response.error?.code).toBe("AGENT_IDENTITY_MISMATCH");
    expect(runner.commands).toEqual([]);
  });

  test("an instruction with a newline is refused before anything is sent", async () => {
    /* A newline is a submit. Smuggling one into the text would run whatever
       followed it as a second command on that terminal, so it is rejected
       rather than escaped. */
    const runner = new RecordingRunner();
    const result = await run(agent(), "instruct", runner, "ls\nrm -rf /");

    expect(result.response.ok).toBe(false);
    expect(result.response.error?.code).toBe("INVALID_INSTRUCTION");
    expect(runner.commands).toEqual([]);
  });

  test("an empty instruction is refused rather than submitted as a bare Enter", async () => {
    // A bare Enter on an agent's terminal re-runs whatever is on its prompt.
    const runner = new RecordingRunner();
    const result = await run(agent(), "instruct", runner, "   ");

    expect(result.response.ok).toBe(false);
    expect(runner.commands).toEqual([]);
  });
});

describe("a cwd string is not identity", () => {
  /* The case this file MISSED on its first pass, and the one where a hollow
     assertion has a real cost.

     control.ts authorises writes on resolution "unique-cwd". targets.ts builds
     that resolution from `cwdMatches.filter(s => s.sourceSessionIds.length === 0)`
     — a pane with ZERO identity evidence, selected because its directory string
     matches and nothing else claimed it. The reason it ships reads "the only
     UNCLAIMED cmux surface with this exact cwd", which is the tell: unclaimed
     is the absence of proof, not proof.

     Measured on this build: an instruction addressed to codex:alpha is sent to
     SURFACE-UNCLAIMED and answered ok:true, status 200. A swarm whose lanes
     share one working tree — as this project's five do — makes that collision
     ordinary rather than exotic, and the failure lands an instruction in a
     stranger's terminal while telling the operator it succeeded.

     Marked failing because the backend is landing fail-closed now. It runs on
     every commit, and the moment "unique-cwd" leaves the authorised set this
     reports "marked as failing but it passed" — remove the marker there and it
     becomes a permanent guard against anyone re-permitting it. */
  const cwdMatched = () => agent({
    target: {
      surfaceId: "SURFACE-UNCLAIMED",
      resolution: "unique-cwd",
      reason: "Matched one active source to the only unclaimed cmux surface with this exact cwd.",
    },
  });

  test("a cwd-matched target is refused an instruction and sends nothing", async () => {
    const runner = new RecordingRunner();
    const result = await run(cwdMatched(), "instruct", runner, "deploy to production");

    expect(result.response.ok).toBe(false);
    expect(result.response.error?.code).toBe("UNSAFE_TARGET");
    expect(runner.commands).toEqual([]);
    expect(runner.argv).not.toContain("deploy to production");
  });

  /* STILL MARKED, and deliberately: this is an open disagreement, not an
     oversight. The tests lane holds that focus should be refused too, because
     it points an operator at a terminal never proven to be the agent's and the
     operator then types there by hand. The interim ruling landed here scoped
     the refusal to Send and Interrupt — the actions that put characters into a
     tty — and kept focus, because looking at the pane is how an operator
     resolves the ambiguity once the write controls are off. Left failing so the
     question stays visible and flips the moment focus is gated. */
  test("focus stays permitted, because looking is how the operator recovers", async () => {
    /* Deliberate, and asserted so a later tightening cannot remove it by
       accident. The gate distinguishes INPUT from navigation: instruct and
       interrupt type into the pane, focus does not. With Send and Interrupt
       switched off, going to look at the pane is the only way an operator can
       tell whether the row found the right terminal — closing that too leaves
       them a dead row and no way to diagnose it.

       A draft of this block asserted focus must ALSO be refused, marked failing
       as though it were a pending fix. It would have contradicted a reasoned
       decision, read as a safety improvement, and enshrined the removal of the
       recovery path the moment anyone "fixed" it. */
    const runner = new RecordingRunner();
    const result = await run(cwdMatched(), "focus", runner);

    expect(result.response.ok).toBe(true);
    expect(runner.argv).toContain("SURFACE-UNCLAIMED");
  });

  test("a cwd-matched target is refused an interrupt", async () => {
    // Interrupt sends Escape. On a stranger's terminal it cancels their work.
    const runner = new RecordingRunner();
    const result = await run(cwdMatched(), "interrupt", runner);

    expect(result.response.ok).toBe(false);
    expect(runner.commands).toEqual([]);
  });

  test("the refusal says why, so the control reads as off rather than broken", async () => {
    /* Was the control pinning the vulnerable behaviour, and it went red when
       fail-closed landed — which is what it was for. What it pins now is the
       other half of the ruling: an operator must be able to tell a deliberate
       refusal from a bug, and be told what would restore the control. */
    const runner = new RecordingRunner();
    const result = await run(cwdMatched(), "instruct", runner, "deploy to production");

    expect(result.response.ok).toBe(false);
    expect(runner.argv).not.toContain("SURFACE-UNCLAIMED");
    expect(runner.argv).not.toContain("deploy to production");
    const message = result.response.error?.message ?? "";
    expect(message).toMatch(/working directory/i);
    expect(message).toMatch(/not attested|cannot be proven/i);
    // It names the way back, so the row does not read as permanently dead.
    expect(message).toMatch(/as soon as cmux attests/i);
  });

  test("an exact match is still allowed, so the fix must not close the door entirely", () => {
    /* The other side of the property. Refusing every route would also stop an
       instruction reaching the agent it names, which is the same failure from
       the opposite direction — and is what a panicked fix looks like. */
    const runner = new RecordingRunner();
    return run(agent(), "instruct", runner, "run the tests").then((result) => {
      expect(result.response.ok).toBe(true);
      expect(runner.argv).toContain(ALPHA_SURFACE);
    });
  });
});

describe("archive is a local record, not a message to the agent", () => {
  test("archiving sends no command to any surface", async () => {
    /* Archive files a session on this board; it does not touch the terminal.
       If it ever shelled out, an operator tidying their board would be acting
       on a live agent. */
    const runner = new RecordingRunner();
    const result = await run(agent(), "archive", runner);

    expect(result.response.ok).toBe(true);
    expect(runner.commands).toEqual([]);
  });

  test("archiving records the agent it was asked to archive", async () => {
    const archived: string[] = [];
    const recording: ArchiveStore = { has: () => false, archive: async (id: string) => { archived.push(id); } };
    await executeControl(
      { agentId: "codex:alpha", action: "archive" },
      agent(),
      { runner: new RecordingRunner(), archiveStore: recording, cmuxExecutable: "cmux" },
    );

    expect(archived).toEqual(["codex:alpha"]);
  });

  test("a failed archive write is reported rather than silently dropped", async () => {
    // The operator believes the board was tidied; if the write failed they
    // must be told, or the row returns on the next refresh with no explanation.
    const broken: ArchiveStore = { has: () => false, archive: async () => { throw new Error("disk full"); } };
    const result = await executeControl(
      { agentId: "codex:alpha", action: "archive" },
      agent(),
      { runner: new RecordingRunner(), archiveStore: broken, cmuxExecutable: "cmux" },
    );

    expect(result.response.ok).toBe(false);
    expect(result.response.error?.code).toBe("ARCHIVE_WRITE_FAILED");
  });
});

describe("acknowledging one agent does not clear another", () => {
  const NOW = Date.parse("2026-08-02T10:00:00.000Z");
  /* The two notifications carry DIFFERENT timestamps on purpose. Acknowledging
     records the acknowledged notification's createdAt as the watermark, so an
     implementation that read the wrong surface's notification would still write
     a record against the right surface — with the wrong instant inside it. With
     identical timestamps that substitution is invisible, and an earlier draft
     of this test could not see it. */
  const ALPHA_AT = "2026-08-02T09:00:00.000Z";
  const BRAVO_AT = "2026-08-02T09:30:00.000Z";
  const wire = (surfaceId: string, id: string, createdAt: string) => JSON.stringify([
    { id, surface_id: surfaceId, workspace_id: "W", title: "Agent needs you", created_at: createdAt },
  ]);

  test("an acknowledgement applies to the surface it names", async () => {
    /* Acknowledge is the one write with no cmux command behind it, which makes
       it easy to assume it cannot go wrong. It can: it silences a row, and
       silencing the wrong row hides an agent that is still waiting. */
    const store = new MemoryAttentionStore(() => NOW);
    const alpha = parseCmuxNotifications(wire(ALPHA_SURFACE, "n-alpha", ALPHA_AT));
    const bravo = parseCmuxNotifications(wire(BRAVO_SURFACE, "n-bravo", BRAVO_AT));
    store.observe([...alpha, ...bravo]);

    await store.apply(ALPHA_SURFACE, "acknowledge");

    // Alpha is cleared; Bravo is untouched and still reaches the operator.
    expect(store.filter(alpha)).toHaveLength(0);
    expect(store.filter(bravo)).toHaveLength(1);
    expect(store.get(BRAVO_SURFACE)).toBeUndefined();
  });

  test("the watermark it records is the acknowledged notification's own instant", async () => {
    /* The substitution the test above cannot see. Reading another surface's
       notification writes a record against the right surface carrying the
       wrong moment — which then suppresses, or fails to suppress, everything
       either side of it. */
    const store = new MemoryAttentionStore(() => NOW);
    store.observe([
      ...parseCmuxNotifications(wire(ALPHA_SURFACE, "n-alpha", ALPHA_AT)),
      ...parseCmuxNotifications(wire(BRAVO_SURFACE, "n-bravo", BRAVO_AT)),
    ]);

    await store.apply(ALPHA_SURFACE, "acknowledge");

    expect(store.get(ALPHA_SURFACE)?.throughAt).toBe(ALPHA_AT);
    expect(store.get(ALPHA_SURFACE)?.notificationId).toBe("n-alpha");
  });

  test("it is looked up by surface, not by position among observed notifications", async () => {
    /* Acknowledging the SECOND surface observed. A lookup that took the first
       entry rather than the named one is invisible when the named surface
       happens to be first — which it was in the test above, so that test passed
       against exactly this substitution. Here the two differ. */
    const store = new MemoryAttentionStore(() => NOW);
    store.observe([
      ...parseCmuxNotifications(wire(ALPHA_SURFACE, "n-alpha", ALPHA_AT)),
      ...parseCmuxNotifications(wire(BRAVO_SURFACE, "n-bravo", BRAVO_AT)),
    ]);

    await store.apply(BRAVO_SURFACE, "acknowledge");

    expect(store.get(BRAVO_SURFACE)?.notificationId).toBe("n-bravo");
    expect(store.get(BRAVO_SURFACE)?.throughAt).toBe(BRAVO_AT);
    // And Alpha, observed first, is still waiting.
    expect(store.get(ALPHA_SURFACE)).toBeUndefined();
  });

  test("acknowledging a surface with no observed notification is refused", async () => {
    /* Fail-closed again: a record written for a surface the store never saw
       would silence the first notification that surface ever produces. */
    const store = new MemoryAttentionStore(() => NOW);

    await expect(store.apply("SURFACE-NEVER-SEEN", "acknowledge")).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
});

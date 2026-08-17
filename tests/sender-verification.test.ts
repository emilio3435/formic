import { describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SENDER_TRANSCRIPT_TAIL_BYTES,
  senderTranscriptTailsFor,
  senderVerificationFor,
} from "../src/server/sender-verification";
import { buildSnapshot } from "../src/server/snapshot";
import { HubState, type HubCollectors } from "../src/server/state";
import type { ArchiveStore, CollectedAgent, CommandRunner } from "../src/server/types";

const SENDER = "claude:8c052fe9-db5c-47c4-9e21-e9b623dd6c82";
const OTHER_SENDER = "codex:019cae18-a854-7750-802d-0bcc2080b46e";
const RUN = "atlas-hardening-2026-08-05";
const BODY = "You are lane be-live. Read the lane brief in full, then start T5.";
const headed = (sender = SENDER, body = BODY): string =>
  `[from ${sender} run ${RUN}] ${body}`;

const transcriptWith = (body: string): string => JSON.stringify({
  type: "assistant",
  message: {
    content: [{
      type: "tool_use",
      name: "Bash",
      input: { command: `anthill-send workspace:80 "${body}"` },
    }],
  },
});

const transcriptEvidence = (text: string, complete = true) => ({ text, complete });

const collectedAgent = (
  id: string,
  lastUserMessage?: string,
): CollectedAgent => ({
  id,
  provider: id.startsWith("claude:") ? "claude" : "codex",
  sourceSessionId: id.slice(id.indexOf(":") + 1),
  displayName: id,
  status: "waiting",
  statusReason: "Waiting for input.",
  updatedAt: "2026-08-05T15:40:00.000Z",
  lastUserMessage,
  tokens: { provenance: "unknown" },
  artifacts: [],
  gates: [],
});

describe("agent message provenance", () => {
  test("verifies a claimed sender only from that sender's bounded transcript tail", () => {
    const tails = new Map([
      [SENDER, transcriptEvidence(transcriptWith(BODY), false)],
      [OTHER_SENDER, transcriptEvidence(transcriptWith("a different instruction"))],
    ]);

    expect(senderVerificationFor({ lastUserMessage: headed(), task: headed() }, tails)).toBe(true);
  });

  test("marks a claim false when the claimed sender's complete transcript lacks the send", () => {
    const tails = new Map([
      [SENDER, transcriptEvidence(transcriptWith("a different instruction"))],
      [OTHER_SENDER, transcriptEvidence(transcriptWith(BODY))],
    ]);

    expect(senderVerificationFor({ lastUserMessage: headed(), task: headed() }, tails)).toBe(false);
  });

  test("keeps unavailable evidence absent instead of manufacturing a forged verdict", () => {
    expect(senderVerificationFor(
      { lastUserMessage: headed(), task: headed() },
      new Map(),
    )).toBeUndefined();
    expect(senderVerificationFor(
      { lastUserMessage: headed(), task: headed() },
      new Map([[SENDER, transcriptEvidence("")]]),
    )).toBe(false);
  });

  test("uses the current user request before a stale headed task", () => {
    const current = "T5 is unlocked now; begin with the provenance verifier.";
    const tails = new Map([
      [SENDER, transcriptEvidence(transcriptWith("the old task"))],
      [OTHER_SENDER, transcriptEvidence(transcriptWith(current))],
    ]);

    expect(senderVerificationFor({
      lastUserMessage: headed(OTHER_SENDER, current),
      task: headed(SENDER, "the old task"),
    }, tails)).toBe(true);
  });

  test("an unheaded current user request does not inherit a stale task's sender", () => {
    expect(senderVerificationFor({
      lastUserMessage: "Please re-run the focused test.",
      task: headed(SENDER, "the original kickoff"),
    }, new Map([[SENDER, transcriptEvidence(transcriptWith("the original kickoff"))]]))).toBeUndefined();
  });

  test("does not verify prose that merely quotes a sender header", () => {
    expect(senderVerificationFor({
      lastUserMessage: `I received "${headed()}" and started.`,
      task: "plain task",
    }, new Map([[SENDER, transcriptEvidence(transcriptWith(BODY))]]))).toBeUndefined();
  });

  test("a wire-truncated head can verify its long prefix but can never prove forgery", () => {
    const longBody = `Goal: ${"verify provenance carefully ".repeat(20)}`.trim();
    /* Live proof from fe-states: lastUserMessage carried 145 real characters
       followed by the wire's U+2026 truncation marker. The marker cannot occur
       at that position in the sender's full transcript. */
    const published = `${longBody.slice(0, 145).trimEnd()}…`;
    expect(published.endsWith("…")).toBe(true);
    expect(published.length).toBeGreaterThanOrEqual(100);

    expect(senderVerificationFor(
      { lastUserMessage: headed(SENDER, published) },
      new Map([[SENDER, transcriptEvidence(transcriptWith(longBody), false)]]),
    )).toBe(true);
    expect(senderVerificationFor(
      { lastUserMessage: headed(SENDER, published) },
      new Map([[SENDER, transcriptEvidence(transcriptWith("a different instruction"))]]),
    )).toBeUndefined();
    const shortPublished = `${longBody.slice(0, 99)}…`;
    expect(senderVerificationFor(
      { lastUserMessage: headed(SENDER, shortPublished) },
      new Map([[SENDER, transcriptEvidence(transcriptWith(longBody))]]),
    )).toBeUndefined();
  });

  test("reads one bounded tail from each claimed sender's own transcript", async () => {
    const reads: Array<{ path: string; maxBytes: number }> = [];
    const tails = await senderTranscriptTailsFor([
      {
        id: "codex:recipient-a",
        lastUserMessage: headed(),
        artifacts: [{ kind: "transcript", path: "/transcripts/recipient-a.jsonl" }],
      },
      {
        id: "codex:recipient-b",
        lastUserMessage: headed(),
        artifacts: [{ kind: "transcript", path: "/transcripts/recipient-b.jsonl" }],
      },
      {
        id: SENDER,
        artifacts: [{ kind: "transcript", path: "/transcripts/sender.jsonl" }],
      },
    ], async (path, maxBytes) => {
      reads.push({ path, maxBytes });
      return transcriptEvidence(transcriptWith(BODY));
    });

    expect(reads).toEqual([{
      path: "/transcripts/sender.jsonl",
      maxBytes: MAX_SENDER_TRANSCRIPT_TAIL_BYTES,
    }]);
    expect(tails.get(SENDER)?.text).toContain(BODY);
  });

  test("does not turn an unreadable sender transcript into readable evidence", async () => {
    const tails = await senderTranscriptTailsFor([
      { id: "codex:recipient", lastUserMessage: headed(), artifacts: [] },
      {
        id: SENDER,
        artifacts: [{ kind: "transcript", path: "/transcripts/unreadable.jsonl" }],
      },
    ], async () => {
      throw new Error("EACCES");
    });

    expect(tails.has(SENDER)).toBe(false);
  });

  test("publishes the tri-state verdict without filling unavailable claims", () => {
    const verifiedId = "codex:verified-recipient";
    const forgedId = "codex:forged-recipient";
    const unavailableId = "codex:unavailable-recipient";
    const snapshot = buildSnapshot({
      agents: [
        collectedAgent(SENDER),
        collectedAgent(verifiedId, headed()),
        collectedAgent(forgedId, headed(SENDER, "This was never sent.")),
        collectedAgent(unavailableId, headed("claude:missing", BODY)),
      ],
      surfaces: [],
      archiveStore: { has: () => false, archive: async () => {} },
      now: new Date("2026-08-05T15:40:00.000Z"),
      senderTranscriptTails: new Map([[SENDER, transcriptEvidence(transcriptWith(BODY))]]),
    });
    const agents = snapshot.programs.flatMap((program) => program.agents);

    expect(agents.find((agent) => agent.id === verifiedId)?.senderVerified).toBe(true);
    expect(agents.find((agent) => agent.id === forgedId)?.senderVerified).toBe(false);
    expect("senderVerified" in (agents.find((agent) => agent.id === unavailableId) ?? {})).toBe(false);
  });

  test("a miss outside the bounded tail stays absent until a later send enters the window", async () => {
    const root = await mkdtemp(join(tmpdir(), "anthill-sender-verification-"));
    const senderPath = join(root, "sender.jsonl");
    try {
      await writeFile(
        senderPath,
        `${transcriptWith(BODY)}\n${"x".repeat(MAX_SENDER_TRANSCRIPT_TAIL_BYTES + 64)}`,
        "utf8",
      );
      const sender = {
        ...collectedAgent(SENDER),
        artifacts: [{ label: "CLAUDE transcript", kind: "transcript", path: senderPath }],
      };
      const recipient = collectedAgent("codex:bounded-recipient", headed());
      const sessions = () => ({
        omp: { value: [], errors: [] },
        codex: { value: [recipient], errors: [] },
        claude: { value: [sender], errors: [] },
        cursor: { value: [], errors: [] },
        factory: { value: [], errors: [] },
        prime: { value: [], errors: [] },
        grok: { value: [], errors: [] },
        hermes: { value: [], errors: [] },
        muse: { value: [], errors: [] },
        antigravity: { value: [], errors: [] },
        copilot: { value: [], errors: [] },
      });
      const collectors: HubCollectors = {
        sessions: async () => sessions(),
        cmux: async () => ({ value: [], errors: [] }),
        notifications: async () => ({ value: [], errors: [] }),
        enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
      };
      const runner: CommandRunner = {
        run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
      };
      const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
      const state = new HubState(runner, archiveStore, [], { collectors });
      const verdict = async (): Promise<boolean | undefined> => {
        const snapshot = await state.refresh();
        return snapshot.programs.flatMap((program) => program.agents)
          .find((agent) => agent.id === recipient.id)?.senderVerified;
      };

      expect(await verdict()).toBeUndefined();
      await appendFile(senderPath, `\n${transcriptWith(BODY)}`, "utf8");
      expect(await verdict()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

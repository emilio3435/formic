import { describe, expect, test } from "bun:test";
import {
  identitiesFromCommand,
  identityFromSessionPath,
  isRecognizedAgentProcess,
} from "../src/server/identity";
import { processEvidenceOf } from "../src/server/lifecycle";
import { PROVIDERS } from "../src/shared/types";
import type { Provider } from "../src/shared/types";

/* Can the process scanner SEE each provider?
 *
 * This file exists because of a specific failure, and the failure is worth
 * stating because nothing else in the suite can catch it. Factory shipped as
 * the fifth collector while `identity.ts` still recognized four. Its sessions
 * were collected and rendered correctly, every test stayed green, and the board
 * quietly declared all three of them over.
 *
 * The reason it is silent is the roster-completeness argument. A scan that
 * completes and matches nothing is evidence of ABSENCE — that is the whole
 * point of it, and it is what turned two hundred `unverified` rows into honest
 * endings. But "the roster is complete" is only true of providers the roster
 * can express. For one it cannot, a successful scan produces the same signal as
 * a genuinely dead session, and the classifier believes it.
 *
 * So these are driven from PROVIDERS rather than written per provider: they
 * cover whichever provider is added NEXT, not the one that was added last. */

const ID = "019fcd73-1a2b-7000-9c4d-5e6f70819aab";

/* A total map: adding a Provider without a sample fails the build here, which
   is the only moment anyone is thinking about that provider's process shape. */
const SAMPLES: Record<Provider, { path?: string; command: string }> = {
  omp: {
    path: `/Users/me/.omp/agent/sessions/my-project/${ID}.jsonl`,
    command: "/Users/me/.local/bin/omp -p --model anthropic/claude-fable-5",
  },
  codex: {
    path: `/Users/me/.codex/sessions/2026/08/04/rollout-2026-08-04T12-00-00-${ID}.jsonl`,
    command: `codex resume ${ID}`,
  },
  claude: {
    path: `/Users/me/.claude/projects/-Users-me-project/${ID}.jsonl`,
    command: `claude --resume ${ID}`,
  },
  cursor: {
    path: `/Users/me/.cursor/chats/0123456789abcdef0123456789abcdef/${ID}/store.db`,
    command: `cursor-agent --resume ${ID}`,
  },
  factory: {
    path: `/Users/me/.factory/sessions/-Users-me-project/${ID}.jsonl`,
    command: `droid -r ${ID}`,
  },
  prime: {
    path: `/Users/me/.prime/agent/sessions/${ID}.jsonl`,
    command: `prime-agent --resume ${ID}`,
  },
  grok: {
    path: `/Users/me/.grok/sessions/%2FUsers%2Fme%2Fproject/${ID}/updates.jsonl`,
    command: `grok -r ${ID}`,
  },
  hermes: {
    path: `/Users/me/.hermes/sessions/${ID}.jsonl`,
    command: `hermes --resume ${ID}`,
  },
  muse: {
    path: `/Users/me/.local/share/muse/sessions/2026/08/16/${ID}/session.jsonl`,
    command: `muse resume ${ID}`,
  },
  antigravity: {
    path: `/Users/me/.gemini/antigravity/conversations/${ID}.db`,
    command: `agy --conversation ${ID}`,
  },
  copilot: {
    path: `/Users/me/.copilot/session-state/${ID}/events.jsonl`,
    command: `copilot --resume ${ID}`,
  },
};

describe("every provider is visible to the process scanner", () => {
  for (const provider of PROVIDERS) {
    if (SAMPLES[provider].path) {
      test(`${provider}: an open transcript names its session`, () => {
        expect(identityFromSessionPath(SAMPLES[provider].path!)).toEqual({
          provider,
          value: ID,
          full: true,
        });
      });
    }

    test(`${provider}: its running process is recognized as an agent`, () => {
      expect(isRecognizedAgentProcess(SAMPLES[provider].command)).toBeTrue();
    });
  }

  test("grok and hermes bare binaries are recognized without resume ids", () => {
    expect(isRecognizedAgentProcess("grok")).toBeTrue();
    expect(isRecognizedAgentProcess("/opt/homebrew/bin/hermes")).toBeTrue();
  });
});

describe("Hermes specifics", () => {
  test("interactive session files name the stem, including non-UUID names", () => {
    expect(identityFromSessionPath("/Users/me/.hermes/sessions/20260815_140000_deadbeef.jsonl")).toEqual({
      provider: "hermes",
      value: "20260815_140000_deadbeef",
      full: true,
    });
  });

  test("--resume and -r name a session; the pause-lift subcommand does not", () => {
    expect(identitiesFromCommand(`hermes --resume ${ID}`)).toEqual([
      { provider: "hermes", value: ID, full: true },
    ]);
    expect(identitiesFromCommand(`hermes -r ${ID}`)).toEqual([
      { provider: "hermes", value: ID, full: true },
    ]);
    expect(identitiesFromCommand("hermes resume")).toEqual([]);
  });
});

describe("what an unseen provider costs", () => {
  /* The consequence the coverage above prevents, asserted directly so that a
     future edit loosening `processEvidenceOf` has to argue with this. */
  test("a completed roster that cannot express a provider reports it dead", () => {
    expect(processEvidenceOf({ processRosterComplete: true })).toBe("absent");
  });

  /* And the other side: without a completed roster the same silence is only
     silence. This is the line between "nothing claims it" and "we did not look". */
  test("an incomplete roster reports the same silence as unavailable", () => {
    expect(processEvidenceOf({})).toBe("unavailable");
  });
});

describe("Factory specifics", () => {
  test("the settings sibling is not a second identity for the session", () => {
    // Factory splits one session across two files. Matching both would double
    // count the session and attribute one pid to two identities.
    expect(
      identityFromSessionPath(`/Users/me/.factory/sessions/-Users-me-project/${ID}.settings.json`),
    ).toBeNull();
  });

  test("droid resume and fork both name the session that follows them", () => {
    expect(identitiesFromCommand(`droid --resume ${ID}`)).toEqual([
      { provider: "factory", value: ID, full: true },
    ]);
    expect(identitiesFromCommand(`droid --fork ${ID}`)).toEqual([
      { provider: "factory", value: ID, full: true },
    ]);
  });

  test("droid without a session id is still an agent process", () => {
    // No id to attribute, but it must not be mistaken for an idle shell —
    // `isRecognizedAgentProcess` is what keeps it in the roster at all.
    expect(isRecognizedAgentProcess("/opt/homebrew/bin/droid --auto high")).toBeTrue();
    expect(isRecognizedAgentProcess("-zsh")).toBeFalse();
  });
});

describe("Copilot CLI specifics", () => {
  test("session-state events.jsonl names the session; --continue does not", () => {
    expect(identityFromSessionPath(`/Users/me/.copilot/session-state/${ID}/events.jsonl`)).toEqual({
      provider: "copilot",
      value: ID,
      full: true,
    });
    expect(identitiesFromCommand(`copilot --resume=${ID}`)).toEqual([
      { provider: "copilot", value: ID, full: true },
    ]);
    expect(identitiesFromCommand("copilot --continue")).toEqual([]);
    expect(isRecognizedAgentProcess("copilot --continue")).toBeTrue();
  });
});

describe("Muse and Antigravity specifics", () => {
  test("muse-bin wrappers are agent processes; resume names the session", () => {
    expect(isRecognizedAgentProcess("/Users/me/.local/bin/muse-bin-0.1.0-R708.1 --no-session-log")).toBe(true);
    expect(identitiesFromCommand(`muse resume ${ID}`)).toEqual([
      { provider: "muse", value: ID, full: true },
    ]);
    expect(identitiesFromCommand("muse resume --last")).toEqual([]);
  });

  test("agy continue is a recognized process; --conversation names the session", () => {
    expect(isRecognizedAgentProcess("agy --continue")).toBe(true);
    expect(identitiesFromCommand(`agy --conversation=${ID}`)).toEqual([
      { provider: "antigravity", value: ID, full: true },
    ]);
  });
});

describe("Grok Build specifics", () => {
  test("B-events-path: summary, updates, and events paths identify only the nested session", () => {
    const root = `/Users/me/.grok/sessions/%2FUsers%2Fme%2Fproject/${ID}`;
    expect(identityFromSessionPath(`${root}/summary.json`)).toEqual({
      provider: "grok", value: ID, full: true,
    });
    expect(identityFromSessionPath(`${root}/updates.jsonl`)).toEqual({
      provider: "grok", value: ID, full: true,
    });
    expect(identityFromSessionPath(`${root}/events.jsonl`)).toEqual({
      provider: "grok", value: ID, full: true,
    });
    expect(identityFromSessionPath(`/private/tmp/${ID}/events.jsonl`)).toBeNull();
  });

  test("B-agent-still-refused: bare agent commands stay unrecognized while the Cursor versioned wrapper stays recognized", () => {
    expect(isRecognizedAgentProcess("agent")).toBeFalse();
    expect(isRecognizedAgentProcess("agent --use-system-ca /tmp/index.js")).toBeFalse();
    expect(isRecognizedAgentProcess([
      "/Users/me/.local/bin/agent",
      "--use-system-ca",
      "/Users/me/.local/share/cursor-agent/versions/2026.08.04-aaa8809/index.js",
    ].join(" "))).toBeTrue();
  });

  test("-r and --resume name a Grok session; -c remains a recognized process", () => {
    for (const command of [`grok -r ${ID}`, `grok --resume ${ID}`, `grok --resume=${ID}`]) {
      expect(identitiesFromCommand(command)).toEqual([
        { provider: "grok", value: ID, full: true },
      ]);
    }
    expect(isRecognizedAgentProcess("grok -c")).toBeTrue();
    expect(identitiesFromCommand("grok -c")).toEqual([]);
  });

  test("a Cursor-hosted Grok model never becomes Grok command identity", () => {
    expect(identitiesFromCommand("cursor-agent --model cursor-grok-4.6-high")).toEqual([]);
    expect(isRecognizedAgentProcess("cursor-agent --model cursor-grok-4.6-high")).toBeTrue();
  });
});

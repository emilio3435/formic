import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  disambiguate,
  paneRename,
  resolveAgentName,
  sessionTag,
  MAX_NAME_LENGTH,
  PROVIDER_DISPLAY_NAMES,
  type AgentIdentity,
  type AuthoredNameSource,
  type NameEvidence,
  type NameSource,
} from "../src/server/naming";
import { PROVIDERS } from "../src/shared/types";

/* The contract is a table, so the test is a table.

   Keeping the rows in a fixture rather than in this file is the point:
   tests/naming-parity.test.ts reads the SAME file and runs it through the web
   client's mirror of this resolver. Two implementations that answer one
   question have already diverged here once — the server built a name from the
   working directory and the client rebuilt a different one behind a
   "contains · and under 56 chars" heuristic — and the only durable fix is a
   single written source of truth that both are made to satisfy. */

interface TruthTableCase {
  name: string;
  tier: number;
  claim: string;
  evidence: NameEvidence;
  expect: {
    name: string;
    base: string;
    source: NameSource;
    authoredBy?: AuthoredNameSource;
  };
}

interface FleetCase {
  name: string;
  claim: string;
  agents: { sourceSessionId: string; evidence: NameEvidence }[];
  expect: string[];
}

interface TruthTable {
  homeDir: string;
  cases: TruthTableCase[];
  fleets: FleetCase[];
}

export const NAMING_TABLE_PATH = join(import.meta.dir, "fixtures", "naming-truth-table.json");

export function loadNamingTable(): TruthTable {
  return JSON.parse(readFileSync(NAMING_TABLE_PATH, "utf8")) as TruthTable;
}

const table = loadNamingTable();

describe("the naming truth table, executed by the server resolver", () => {
  for (const testCase of table.cases) {
    test(testCase.name, () => {
      expect(resolveAgentName(testCase.evidence, table.homeDir)).toEqual(testCase.expect);
    });
  }
});

describe("the naming truth table, executed fleet-wide", () => {
  for (const fleet of table.fleets) {
    test(fleet.name, () => {
      const entries = fleet.agents.map((agent) => ({
        sourceSessionId: agent.sourceSessionId,
        identity: resolveAgentName(agent.evidence, table.homeDir),
      }));
      expect(disambiguate(entries).map((identity) => identity.name)).toEqual(fleet.expect);
    });
  }
});

describe("the truth table covers the contract it claims to", () => {
  const TIERS = [1, 2, 3, 4, 5, 6];

  test("every tier in the precedence chain has at least one case", () => {
    const covered = new Set(table.cases.map((testCase) => testCase.tier));
    expect([...covered].sort()).toEqual(TIERS);
  });

  test("every case states the claim it is defending", () => {
    for (const testCase of table.cases) {
      expect(testCase.claim.length).toBeGreaterThan(20);
    }
    for (const fleet of table.fleets) {
      expect(fleet.claim.length).toBeGreaterThan(20);
    }
  });

  /* A fleet case whose expectations are all distinct proves nothing about
     collisions unless the bases actually collided first. */
  test("every fleet expectation names as many sessions as it was given", () => {
    for (const fleet of table.fleets) {
      expect(fleet.expect).toHaveLength(fleet.agents.length);
    }
  });
});

describe("what the resolver refuses to decide", () => {
  const base = (): NameEvidence => ({
    provider: "claude",
    sourceSessionId: "dad9736f-1111-2222-3333-444455556666",
    originCwd: "/Users/ant/Developer/the-mountain-main",
  });

  /* Uniqueness is a property of a fleet, and the resolver is only ever shown
     one session. If it could invent a disambiguator alone it would invent a
     different one each time the fleet changed around it. */
  test("resolving one session never produces a disambiguator", () => {
    const identity = resolveAgentName(base(), "/Users/ant");
    expect(identity.disambiguator).toBeUndefined();
    expect(identity.name).toBe(identity.base);
  });

  test("a lone session keeps the name it resolved to", () => {
    const identity = resolveAgentName(base(), "/Users/ant");
    const [only] = disambiguate([{ sourceSessionId: base().sourceSessionId, identity }]);
    expect(only).toEqual(identity);
  });
});

describe("the name never moves once the session has one", () => {
  /* The bug this module exists to remove. A Claude transcript records cwd per
     entry, so reading the latest made the name follow the shell: the session
     that wrote this file renamed itself four times in four minutes from
     read-only git and ls commands, and at one point published under another
     lane's name. Identity reads the FIRST cwd, so every one of these is the
     same session with the same name. */
  const WANDERED = [
    "/Users/ant",
    "/Users/ant/Developer/the-mountain-main",
    "/Users/ant/Developer/the-mountain-lanes/lifecycle-contract-20260804",
    "/Users/ant/Developer/the-mountain-lanes/naming-contract-20260804",
  ];

  test("the same origin resolves to the same name however far the shell wandered", () => {
    const names = WANDERED.map(() =>
      resolveAgentName(
        {
          provider: "claude",
          sourceSessionId: "dad9736f-1111-2222-3333-444455556666",
          originCwd: "/Users/ant/Developer/the-mountain-main",
        },
        "/Users/ant",
      ).name,
    );
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toBe("Claude · the-mountain-main");
  });

  /* The counter-proof: if the wire ever carries the latest cwd into this field
     instead of the first, these ARE four different names. The assertion exists
     so a future edit that "simplifies" originCwd back to cwd fails here with a
     message that says why. */
  test("had it read the latest directory instead, the same session would have had four names", () => {
    const names = WANDERED.map(
      (cwd) =>
        resolveAgentName(
          { provider: "claude", sourceSessionId: "dad9736f-1111-2222-3333-444455556666", originCwd: cwd },
          "/Users/ant",
        ).name,
    );
    expect(new Set(names).size).toBe(4);
  });
});

describe("the session tag separates what the name could not", () => {
  /* The TAIL, not the head. Codex issues UUIDv7 whose leading segment is a
     timestamp, so every session started in the same minute shares it — tagging
     by prefix put "#019fb496" on four rows and disambiguated nothing. */
  test("two sessions minted in the same minute get different tags", () => {
    const first = sessionTag("019fb496-8a71-7000-8000-1111aaaabbbb");
    const second = sessionTag("019fb496-8a71-7000-8000-2222ccccdddd");
    expect(first).not.toBe(second);
  });

  test("a tag is short enough to read and long enough to separate", () => {
    expect(sessionTag("019fb496-8a71-7000-8000-1111aaaabbbb")).toBe("aaaabbbb");
  });

  test("an id with no segments still yields its own tail", () => {
    expect(sessionTag("abcdef0123456789")).toBe("23456789");
  });

  test("an empty id yields no tag", () => {
    expect(sessionTag("   ")).toBe("");
  });

  /* Nothing stable to separate them by. Inventing a tag from array position
     would change the name between refreshes, which is precisely the bug being
     removed, so the duplicate stays visible instead of being papered over. */
  test("sessions with no id at all are left sharing a name rather than given an unstable one", () => {
    const identity = resolveAgentName(
      { provider: "claude", sourceSessionId: "", originCwd: "/Users/ant/Developer/the-mountain-main" },
      "/Users/ant",
    );
    const named = disambiguate([
      { sourceSessionId: "", identity },
      { sourceSessionId: "", identity },
    ]);
    expect(named.map((entry) => entry.name)).toEqual([
      "Claude · the-mountain-main",
      "Claude · the-mountain-main",
    ]);
  });
});

describe("every provider can be named", () => {
  /* PROVIDERS proves the union is complete; this proves the display map is too.
     A provider added to the union without a display name here would otherwise
     surface as "undefined session" on the board. */
  test("every provider has a display name", () => {
    for (const provider of PROVIDERS) {
      expect(PROVIDER_DISPLAY_NAMES[provider]).toBeTruthy();
    }
  });

  test("every provider yields a non-empty fallback name", () => {
    for (const provider of PROVIDERS) {
      const identity = resolveAgentName({ provider, sourceSessionId: "x" }, "/Users/ant");
      expect(identity.name.length).toBeGreaterThan(0);
      expect(identity.source).toBe("provider-fallback");
    }
  });
});

describe("names stay within the one cap the operator shares", () => {
  const overlong = "x".repeat(MAX_NAME_LENGTH + 40);

  test("no tier can produce a name an operator could not retype", () => {
    const tiers: NameEvidence[] = [
      { provider: "claude", sourceSessionId: "s", operatorAlias: { agent: overlong } },
      { provider: "claude", sourceSessionId: "s", authored: { name: overlong, by: "launch-env" } },
      { provider: "claude", sourceSessionId: "s", originCwd: `/Users/ant/${overlong}` },
      { provider: "claude", sourceSessionId: "s", taskName: overlong },
    ];
    const sources: NameSource[] = [];
    for (const evidence of tiers) {
      const identity: AgentIdentity = resolveAgentName(evidence, "/Users/ant");
      expect(identity.name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      sources.push(identity.source);
    }
    /* Proof the four cases exercised four different tiers rather than all
       falling through to the same one. */
    expect(sources).toEqual(["operator-alias", "authored", "origin-cwd", "task"]);
  });
});

describe("telling a cmux rename from a title cmux wrote itself", () => {
  /* Factory publishes `isSessionTitleManuallySet`; cmux publishes no such flag,
     so a pane title has to be read for whether a human could plausibly have
     typed it. Getting this wrong is not neutral — cmux titles EVERY pane, so
     accepting its defaults means the account name outranks a distilled title.
     Measured on the live board: "Ant Hill Naming & Lifecycle Investigation"
     was replaced by "emilionunezgarcia". */
  const HOME = "/Users/ant";

  test("a title the operator typed is a rename", () => {
    expect(paneRename("Implement approved plan for unified piglet", "/Users/ant/Developer/x", HOME))
      .toBe("Implement approved plan for unified piglet");
  });

  test("the account name is not a rename", () => {
    expect(paneRename("ant", "/Users/ant/Developer/x", HOME)).toBeUndefined();
    // Case is cmux's business, not the operator's.
    expect(paneRename("Ant", "/Users/ant/Developer/x", HOME)).toBeUndefined();
  });

  test("a path is not a rename", () => {
    expect(paneRename("~", "/Users/ant", HOME)).toBeUndefined();
    expect(paneRename("~/Developer/the-mountain-main", "/Users/ant/Developer/the-mountain-main", HOME))
      .toBeUndefined();
    expect(paneRename("/Users/ant/Developer/x", "/Users/ant/Developer/x", HOME)).toBeUndefined();
  });

  test("the pane's own folder name is not a rename", () => {
    /* cmux's default for a project pane. It reads like a name and is the one
       default most likely to be mistaken for one. */
    expect(paneRename("LaHormigaDormida", "/Users/ant/Developer/LaHormigaDormida", HOME))
      .toBeUndefined();
  });

  test("a folder name typed onto a pane sitting somewhere else IS a rename", () => {
    // The contrast case: the rule is "echoes this pane's folder", not "looks
    // like a folder". An operator who names a pane after the project it is
    // working ON, from a different directory, meant it.
    expect(paneRename("LaHormigaDormida", "/Users/ant", HOME)).toBe("LaHormigaDormida");
  });

  test("the boilerplate every other name-shaped field is checked for is rejected here too", () => {
    expect(paneRename("Session update", "/Users/ant/Developer/x", HOME)).toBeUndefined();
    expect(paneRename("new agent", "/Users/ant/Developer/x", HOME)).toBeUndefined();
  });

  test("nothing at all is not a rename", () => {
    expect(paneRename(undefined, "/Users/ant", HOME)).toBeUndefined();
    expect(paneRename("   ", "/Users/ant", HOME)).toBeUndefined();
  });
});

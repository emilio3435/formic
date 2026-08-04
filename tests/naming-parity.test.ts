import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  disambiguate as disambiguateOnServer,
  resolveAgentName as resolveOnServer,
  sessionTag as tagOnServer,
  MAX_NAME_LENGTH,
  PROVIDER_DISPLAY_NAMES,
  type NameEvidence,
} from "../src/server/naming";
import { PROVIDERS } from "../src/shared/types";

/* The file that makes "one resolver" a checkable claim rather than an intention.

   Server and client each need to answer "what is this session called?" — the
   server for the wire, the client for the fallback when an archived row arrives
   without the field. Before this, the two answered differently: the server
   built a name from the working directory, and `sourceAgentName` rebuilt one
   behind a heuristic that a name is trustworthy only if it contains "·" and is
   under 56 characters. That heuristic existed because the client could not tell
   an authored name from a derived one, and it got the answer backwards — an
   agent named "Lifecycle Mapper" lost to "Claude · the-mountain-main".

   So the rules live in a fixture neither implementation owns, and both are
   executed against it here. A rule added to one and forgotten in the other
   fails on this file, naming the case. */

interface TruthTableCase {
  name: string;
  tier: number;
  claim: string;
  evidence: NameEvidence;
  expect: Record<string, unknown>;
}

interface FleetCase {
  name: string;
  claim: string;
  agents: { sourceSessionId: string; evidence: NameEvidence }[];
  expect: string[];
}

const table = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "naming-truth-table.json"), "utf8"),
) as { homeDir: string; cases: TruthTableCase[]; fleets: FleetCase[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  client = await import("../src/web/naming.js");
});

describe("the naming truth table, executed by the client mirror", () => {
  for (const testCase of table.cases) {
    test(testCase.name, () => {
      expect(client.resolveAgentName(testCase.evidence, table.homeDir)).toEqual(testCase.expect);
    });
  }
});

describe("the two implementations answer identically", () => {
  for (const testCase of table.cases) {
    test(testCase.name, () => {
      expect(client.resolveAgentName(testCase.evidence, table.homeDir)).toEqual(
        resolveOnServer(testCase.evidence, table.homeDir),
      );
    });
  }

  for (const fleet of table.fleets) {
    test(`fleet — ${fleet.name}`, () => {
      const entries = fleet.agents.map((agent) => ({
        sourceSessionId: agent.sourceSessionId,
        identity: resolveOnServer(agent.evidence, table.homeDir),
      }));
      const clientEntries = fleet.agents.map((agent) => ({
        sourceSessionId: agent.sourceSessionId,
        identity: client.resolveAgentName(agent.evidence, table.homeDir),
      }));
      const fromServer = disambiguateOnServer(entries);
      const fromClient = client.disambiguate(clientEntries);
      expect(fromClient).toEqual(fromServer);
      expect(fromClient.map((identity: { name: string }) => identity.name)).toEqual(fleet.expect);
    });
  }
});

describe("the mirror mirrors the whole surface, not only the parts under test", () => {
  /* A mirror that is missing an export is a mirror that silently falls back to
     the client's old answer at the one call site nobody tested. */
  test("both implementations export the same functions", () => {
    for (const name of ["resolveAgentName", "sessionTag", "disambiguate"]) {
      expect(typeof client[name], `src/web/naming.js does not export ${name}`).toBe("function");
    }
  });

  test("the one shared cap really is shared", () => {
    expect(client.MAX_NAME_LENGTH).toBe(MAX_NAME_LENGTH);
  });

  test("both spell every provider the same way", () => {
    for (const provider of PROVIDERS) {
      expect(client.PROVIDER_DISPLAY_NAMES[provider]).toBe(PROVIDER_DISPLAY_NAMES[provider]);
    }
  });

  test("both derive the same tag from the same session id", () => {
    const ids = [
      "019fb496-8a71-7000-8000-1111aaaabbbb",
      "dad9736f-1111-2222-3333-444455556666",
      "abcdef0123456789",
      "1111-shared99",
      "",
      "   ",
    ];
    for (const id of ids) {
      expect(client.sessionTag(id), `tags disagree for "${id}"`).toBe(tagOnServer(id));
    }
  });
});

describe("the mirror does not import what a browser cannot load", () => {
  /* src/web/ is a dependency-free ES-module client the server hands to the
     browser as-is — there is no build step and no bundler to shim node
     built-ins. An import of node:path here would not fail any behavioural test;
     it would fail in the browser, at run time, on the one surface that needs
     this file. So the constraint is asserted rather than trusted. */
  test("it declares no imports at all", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "web", "naming.js"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runFormicCli } from "../src/cli/formic";

describe("formic cli", () => {
  test("default root is this checkout, not an operator path", () => {
    const src = readFileSync(join(import.meta.dir, "../src/cli/formic.ts"), "utf8");
    expect(src).toContain("FORMIC_ROOT");
    expect(src).toContain('join(import.meta.dir, "..", "..")');
    expect(src).not.toContain("the-mountain-production");
    expect(src).not.toContain("/Users/emilionunezgarcia");
    expect(src).not.toContain("~/anthill");
  });

  test("fleet sends Bearer to loopback /api/orch/fleet", async () => {
    const urls: string[] = [];
    const headers: string[] = [];
    const result = await runFormicCli(["fleet"], {
      FORMIC_URL: "http://127.0.0.1:4701",
      FORMIC_ORCH_TOKEN: "tok",
    }, {
      randomUUID: () => "uuid-1",
      fetch: async (input, init) => {
        urls.push(String(input));
        headers.push(String((init?.headers as Record<string, string> | undefined)?.authorization));
        return new Response(JSON.stringify({ ok: true, agents: [], workspaces: [] }), { status: 200 });
      },
    });
    expect(result.exitCode).toBe(0);
    expect(urls).toEqual(["http://127.0.0.1:4701/api/orch/fleet"]);
    expect(headers).toEqual(["Bearer tok"]);
  });

  test("refuses a non-loopback URL without fetching", async () => {
    let fetched = false;
    const result = await runFormicCli(["fleet"], {
      FORMIC_URL: "http://example.com",
      FORMIC_ORCH_TOKEN: "tok",
    }, {
      randomUUID: () => "uuid-1",
      fetch: async () => {
        fetched = true;
        return new Response("{}");
      },
    });
    expect(result.exitCode).toBe(1);
    expect(fetched).toBe(false);
  });

  test("send posts agentId, instruction, and nonce", async () => {
    let body = "";
    const result = await runFormicCli(
      ["send", "grok:bot:abc", "List failing tests."],
      { FORMIC_URL: "http://127.0.0.1:4701", FORMIC_ORCH_TOKEN: "tok", FORMIC_NONCE: "n1" },
      {
        randomUUID: () => "uuid-1",
        fetch: async (_input, init) => {
          body = String(init?.body ?? "");
          return new Response(JSON.stringify({ ok: true, action: "instruct", agentId: "grok:bot:abc" }));
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(body)).toEqual({
      agentId: "grok:bot:abc",
      instruction: "List failing tests.",
      clientNonce: "n1",
    });
  });

  test("prints a refused send and exits 1", async () => {
    const result = await runFormicCli(
      ["send", "grok:bot:abc", "Hi"],
      { FORMIC_URL: "http://127.0.0.1:4701", FORMIC_ORCH_TOKEN: "tok" },
      {
        randomUUID: () => "uuid-1",
        fetch: async () => new Response(JSON.stringify({
          ok: false,
          error: { code: "UNSAFE_TARGET", message: "No." },
        })),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("UNSAFE_TARGET");
  });

  test("peek GETs /api/orch/peek and peek id adds agentId", async () => {
    const urls: string[] = [];
    const all = await runFormicCli(["peek"], {
      FORMIC_URL: "http://127.0.0.1:4701",
      FORMIC_ORCH_TOKEN: "tok",
    }, {
      randomUUID: () => "uuid-1",
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ ok: true, cards: [] }), { status: 200 });
      },
    });
    expect(all.exitCode).toBe(0);
    const one = await runFormicCli(["peek", "grok:bot:abc"], {
      FORMIC_URL: "http://127.0.0.1:4701",
      FORMIC_ORCH_TOKEN: "tok",
    }, {
      randomUUID: () => "uuid-1",
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ ok: true, cards: [{ id: "grok:bot:abc" }] }), { status: 200 });
      },
    });
    expect(one.exitCode).toBe(0);
    expect(urls).toEqual([
      "http://127.0.0.1:4701/api/orch/peek",
      "http://127.0.0.1:4701/api/orch/peek?agentId=grok%3Abot%3Aabc",
    ]);
  });

  test("launch bash is refused before fetch", async () => {
    let fetched = false;
    const result = await runFormicCli(
      ["launch", "--cwd", "/Users/me/proj", "--command", "bash"],
      { FORMIC_URL: "http://127.0.0.1:4701", FORMIC_ORCH_TOKEN: "tok" },
      {
        randomUUID: () => "uuid-1",
        fetch: async () => {
          fetched = true;
          return new Response("{}");
        },
      },
    );
    expect(result.exitCode).toBe(1);
    expect(fetched).toBe(false);
    expect(result.stderr).toContain("codex, claude, or grok");
  });
});

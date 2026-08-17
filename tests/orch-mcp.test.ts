import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleOrchMcpMessage } from "../src/mcp/formic-orch";

const env = { FORMIC_URL: "http://127.0.0.1:4701", FORMIC_ORCH_TOKEN: "tok" };

describe("formic orch mcp", () => {
  test("default root is this checkout, not an operator path", () => {
    const src = readFileSync(join(import.meta.dir, "../src/mcp/formic-orch.ts"), "utf8");
    expect(src).toContain("FORMIC_ROOT");
    expect(src).toContain('join(import.meta.dir, "..", "..")');
    expect(src).not.toContain("the-mountain-production");
    expect(src).not.toContain("/Users/emilionunezgarcia");
    expect(src).not.toContain("~/anthill");
  });

  test("tools/list is exactly the four formic verbs", async () => {
    const raw = await handleOrchMcpMessage({ id: 1, method: "tools/list" }, env, async () => new Response("{}"));
    const msg = JSON.parse(raw) as { result: { tools: Array<{ name: string }> } };
    expect(msg.result.tools.map((tool) => tool.name)).toEqual([
      "formic_fleet",
      "formic_peek",
      "formic_send",
      "formic_launch",
    ]);
  });

  test("formic_fleet GETs /api/orch/fleet with Bearer", async () => {
    const urls: string[] = [];
    const headers: string[] = [];
    const raw = await handleOrchMcpMessage({ id: 2, method: "tools/call", params: { name: "formic_fleet", arguments: {} } }, env, async (input, init) => {
      urls.push(String(input));
      headers.push(String((init?.headers as Record<string, string> | undefined)?.authorization));
      return new Response(JSON.stringify({ ok: true, agents: [] }));
    });
    expect(urls).toEqual(["http://127.0.0.1:4701/api/orch/fleet"]);
    expect(headers).toEqual(["Bearer tok"]);
    expect(raw).toContain("\\\"ok\\\":true");
  });

  test("formic_peek GETs /api/orch/peek and rejects extra keys", async () => {
    const urls: string[] = [];
    const raw = await handleOrchMcpMessage({
      id: 6,
      method: "tools/call",
      params: { name: "formic_peek", arguments: { agentId: "grok:bot:abc" } },
    }, env, async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ ok: true, cards: [] }));
    });
    expect(urls).toEqual(["http://127.0.0.1:4701/api/orch/peek?agentId=grok%3Abot%3Aabc"]);
    expect(raw).toContain("\\\"ok\\\":true");
    let fetched = false;
    const extra = await handleOrchMcpMessage({
      id: 7,
      method: "tools/call",
      params: { name: "formic_peek", arguments: { agentId: "x", rpc: "nope" } },
    }, env, async () => {
      fetched = true;
      return new Response("{}");
    });
    expect(fetched).toBe(false);
    expect(extra).toContain("Unsupported formic_peek field");
  });

  test("formic_send rejects newlines before fetch", async () => {
    let fetched = false;
    const raw = await handleOrchMcpMessage({
      id: 3,
      method: "tools/call",
      params: { name: "formic_send", arguments: { agentId: "x", instruction: "a\nb" } },
    }, env, async () => {
      fetched = true;
      return new Response("{}");
    });
    expect(fetched).toBe(false);
    expect(raw).toContain("single line");
  });

  test("formic_launch bash is refused before fetch", async () => {
    let fetched = false;
    const raw = await handleOrchMcpMessage({
      id: 4,
      method: "tools/call",
      params: { name: "formic_launch", arguments: { cwd: "/Users/me/p", command: "bash" } },
    }, env, async () => {
      fetched = true;
      return new Response("{}");
    });
    expect(fetched).toBe(false);
    expect(raw).toContain("codex, claude, or grok");
  });

  test("non-loopback FORMIC_URL errors on first call", async () => {
    const raw = await handleOrchMcpMessage(
      { id: 5, method: "tools/call", params: { name: "formic_fleet", arguments: {} } },
      { FORMIC_URL: "http://example.com", FORMIC_ORCH_TOKEN: "tok" },
      async () => new Response("{}"),
    );
    expect(raw).toContain("loopback");
  });
});

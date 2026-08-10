import { describe, expect, test } from "bun:test";

// @ts-expect-error the dependency-free browser client has no declaration file
const P = await import("../src/web/presentation.js");
const parse = (P as { parseTaskEnvelope: (raw: unknown) => { objective: string; meta: Record<string, string> } }).parseTaskEnvelope;

describe("parseTaskEnvelope — one anatomy from five envelope shapes", () => {
  test("kickoff prose: objective is the first sentence, no meta invented", () => {
    const raw = "Redesign the filter bar so tab counts follow the working set. Then wire the aria-live region. Details in the plan doc.";
    const out = parse(raw);
    expect(out.objective).toBe("Redesign the filter bar so tab counts follow the working set.");
    expect(out.meta).toEqual({});
  });

  test("handoff dump: headers land in meta, objective is the body's first sentence, hex ids stay out of the face", () => {
    const raw = [
      "[from orchestrator-1 run 578d9487-dceb-4034-b4f1-97a74ae247fd]",
      "Date: 2026-08-09",
      "From: orchestrator-1",
      "To: lane-fe-2",
      "Branch: chore/docker-local-ci",
      "Run: claude_578d9487-dceb-4034-b4f1-97a74ae247fd",
      "",
      "Take over the drawer task widget. Keep the 25% cap intact.",
    ].join("\n");
    const out = parse(raw);
    expect(out.objective).toBe("Take over the drawer task widget.");
    expect(out.meta).toEqual({
      date: "2026-08-09",
      from: "orchestrator-1",
      to: "lane-fe-2",
      branch: "chore/docker-local-ci",
      run: "claude_578d9487-dceb-4034-b4f1-97a74ae247fd",
    });
    expect(out.objective).not.toMatch(/[0-9a-f]{8}-/);
  });

  test("image-placeholder task: placeholders are not prose, objective is honestly empty", () => {
    const out = parse('<image name="shot-1440.png"> <image name="shot-390.png">');
    expect(out.objective).toBe("");
    expect(out.meta).toEqual({});
  });

  test("empty task: empty in, empty out — never a crash, never invented text", () => {
    expect(parse("")).toEqual({ objective: "", meta: {} });
    expect(parse(undefined)).toEqual({ objective: "", meta: {} });
  });

  test("plain one-liner without terminal punctuation: the whole line is the objective", () => {
    const out = parse("fix the flaky cursor collector");
    expect(out.objective).toBe("fix the flaky cursor collector");
    expect(out.meta).toEqual({});
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMountainFetch, type MountainAppState, type MountainFetch } from "../src/server/app";
import { buildSnapshot } from "../src/server/snapshot";
import type { HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent, CommandRunner } from "../src/server/types";

interface FakeNode {
  nodeType: number;
  tagName: string;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  children: FakeNode[];
  parent: FakeNode | null;
  readonly childNodes: FakeNode[];
  readonly childElementCount: number;
  readonly firstChild: FakeNode | null;
  readonly nextSibling: FakeNode | null;
  classList: {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    toggle(name: string, on?: boolean): void;
    contains(name: string): boolean;
  };
  setAttribute(key: string, value: unknown): void;
  removeAttribute(key: string): void;
  hasAttribute(key: string): boolean;
  addEventListener(type: string, listener: (event: unknown) => unknown): void;
  append(...children: unknown[]): void;
  insertBefore(child: FakeNode, reference: FakeNode | null): void;
  remove(): void;
}

function makeNode(tag: string): FakeNode {
  const classes = new Set<string>();
  let text = "";
  const node = {
    nodeType: 1,
    tagName: tag,
    get textContent() { return text; },
    set textContent(value: string) { text = String(value ?? ""); node.children.length = 0; },
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    children: [] as FakeNode[],
    parent: null as FakeNode | null,
    get className() { return [...classes].join(" "); },
    set className(value: string) {
      classes.clear();
      for (const name of String(value).split(/\s+/)) if (name) classes.add(name);
    },
    classList: {
      add(...names: string[]) { for (const name of names) if (name) classes.add(name); },
      remove(...names: string[]) { for (const name of names) classes.delete(name); },
      toggle(name: string, on?: boolean) {
        if (on === undefined ? classes.has(name) : !on) classes.delete(name);
        else classes.add(name);
      },
      contains(name: string) { return classes.has(name); },
    },
    get childNodes() { return node.children; },
    get childElementCount() { return node.children.length; },
    get firstChild() { return node.children[0] ?? null; },
    get nextSibling() {
      if (!node.parent) return null;
      const index = node.parent.children.indexOf(node as unknown as FakeNode);
      return index >= 0 ? node.parent.children[index + 1] ?? null : null;
    },
    setAttribute(key: string, value: unknown) { node.attributes[key] = String(value); },
    removeAttribute(key: string) { delete node.attributes[key]; },
    hasAttribute(key: string) { return key in node.attributes; },
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
    listeners: {} as Record<string, Array<(event: unknown) => unknown>>,
    addEventListener(type: string, listener: (event: unknown) => unknown) {
      (node.listeners[type] ??= []).push(listener);
    },
    append(...children: unknown[]) {
      for (const child of children) {
        if (child == null) continue;
        node.children.push(child as FakeNode);
        if (typeof child === "object" && "parent" in (child as FakeNode)) (child as FakeNode).parent = node as unknown as FakeNode;
      }
    },
    insertBefore(child: FakeNode, reference: FakeNode | null) {
      if (child.parent) {
        const previous = child.parent.children.indexOf(child);
        if (previous >= 0) child.parent.children.splice(previous, 1);
      }
      child.parent = node as unknown as FakeNode;
      const index = reference ? node.children.indexOf(reference) : -1;
      if (index < 0) node.children.push(child);
      else node.children.splice(index, 0, child);
    },
    remove() {
      if (!node.parent) return;
      const index = node.parent.children.indexOf(node as unknown as FakeNode);
      if (index >= 0) node.parent.children.splice(index, 1);
      node.parent = null;
    },
  };
  return node as unknown as FakeNode;
}

function fakeDocument() {
  return {
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (_namespace: string, tag: string) => makeNode(tag),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: String(text) }),
    getElementById: () => makeNode("div"),
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
  };
}

function withDom<T>(operation: () => T): T {
  (globalThis as unknown as { document: unknown }).document = fakeDocument();
  try {
    return operation();
  } finally {
    delete (globalThis as unknown as { document?: unknown }).document;
  }
}

function textOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as FakeNode;
  if (value.nodeType === 3) return String(value.textContent ?? "");
  return String(value.textContent ?? "") + (value.children ?? []).map(textOf).join("");
}

function classesOf(node: unknown, found: string[] = []): string[] {
  if (!node || typeof node !== "object") return found;
  const value = node as FakeNode;
  if (value.className) found.push(...value.className.split(/\s+/).filter(Boolean));
  for (const child of value.children ?? []) classesOf(child, found);
  return found;
}

let scratch = "";
let repo = "";
let home = "";
let shell = "";
let apiSnapshot: HubSnapshot;
let fetchApp: MountainFetch;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const neverRunner: CommandRunner = {
  run: async (command) => { throw new Error(`GET fixture attempted command: ${command.join(" ")}`); },
};

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || `git ${args.join(" ")} failed`);
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anthill-cwd-browser-"));
  repo = join(scratch, "cooper-scheduler");
  home = join(scratch, "agent-home");
  shell = join(scratch, "terminal-shell");
  await Promise.all([repo, home, shell].map((path) => mkdir(path, { recursive: true })));
  git(repo, "init", "--initial-branch=main");
  await writeFile(join(repo, "README.md"), "cooper\n", "utf8");
  git(repo, "add", "README.md");
  git(repo, "-c", "user.name=Ant Hill Test", "-c", "user.email=anthill@example.invalid", "commit", "-m", "fixture");
  repo = await realpath(repo);

  const agent: CollectedAgent = {
    id: "claude:pictured-browser",
    provider: "claude",
    sourceSessionId: "pictured-browser",
    displayName: "Pictured Claude",
    cwd: repo,
    launchCwd: home,
    status: "running",
    statusReason: "Fixture activity is recent.",
    startedAt: "2026-08-06T15:00:00.000Z",
    updatedAt: "2026-08-06T15:59:30.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
  };
  const snapshot = buildSnapshot({
    agents: [agent],
    surfaces: [{
      workspaceId: "WORKSPACE-BROWSER",
      surfaceId: "SURFACE-BROWSER",
      paneId: "PANE-BROWSER",
      workspaceTitle: "Cooper terminal",
      title: "Cooper operator pane",
      cwd: shell,
      runtimeSurfaceReady: true,
      sourceSessionIds: [agent.sourceSessionId],
    }],
    programHints: [{ id: "cooper", name: "Cooper", match: [repo] }],
    archiveStore,
    now: new Date("2026-08-06T16:00:00.000Z"),
  });
  const state: MountainAppState = {
    get: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
  };
  fetchApp = createMountainFetch({ state, runner: neverRunner, archiveStore, webRoot: import.meta.dir });
  const response = await fetchApp(new Request("http://127.0.0.1:4711/api/snapshot"));
  apiSnapshot = await response.json() as HubSnapshot;

  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  client = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

afterAll(async () => {
  fetchApp?.dispose();
  await rm(scratch, { recursive: true, force: true });
});

describe("synthetic API payload rendered by the real browser client", () => {
  test("ADV-CWD-BROWSER-1 exact controls, Cooper grouping, and neutral provenance survive API serialization", () => {
    const program = apiSnapshot.programs[0]!;
    const agent = program.agents[0]!;
    expect(program).toMatchObject({ id: "cooper", name: "Cooper" });
    expect(agent).toMatchObject({
      cwd: repo,
      launchCwd: home,
      repo: { worktreePath: repo },
      target: {
        resolution: "exact",
        attestation: "live",
        surfaceId: "SURFACE-BROWSER",
        surfaceCwd: shell,
        cwdRelation: "different",
      },
    });
    expect(agent.controls.find(({ action }) => action === "instruct")?.enabled).toBeTrue();

    const evidence = withDom(() => client.renderEvidence(agent));
    const rendered = textOf(evidence);
    expect(rendered).toContain("Agent current folder");
    expect(rendered).toContain("Agent launch folder");
    expect(rendered).toContain("Terminal shell folder");
    expect(rendered).toContain("Target repository");
    expect(rendered).toContain("Linked for Focus and Send.");
    expect(rendered).toContain("Claude’s tool session and the terminal shell maintain separate working directories. This does not change the exact cmux link.");
    expect(rendered).not.toMatch(/mismatch|session cwd|≠/i);

    const row = withDom(() => client.renderAgentRow(agent, program));
    expect(classesOf(row)).not.toContain("source-mismatch-dot");
    expect(classesOf(row)).not.toContain("is-mismatch");
  });

  test("ADV-CWD-WIRE-1 a legacy cwdMismatch field is ignored by the new client", () => {
    const current = apiSnapshot.programs[0]!.agents[0]!;
    const legacy = JSON.parse(JSON.stringify(current));
    delete legacy.target.cwdRelation;
    legacy.target.cwdMismatch = true;

    const evidence = withDom(() => client.renderEvidence(legacy));
    const rendered = textOf(evidence);
    expect(rendered).toContain("Linked for Focus and Send.");
    expect(rendered).not.toContain("maintain separate working directories");
    expect(rendered).not.toMatch(/mismatch|session cwd|≠/i);
    expect(client.quietSourceLine(legacy)).toBeNull();
  });

  test("ADV-CWD-SECRET-1 API and DOM contain no launch command material", () => {
    const serialized = JSON.stringify(apiSnapshot);
    const evidence = withDom(() => client.renderEvidence(apiSnapshot.programs[0]!.agents[0]!));
    expect(serialized).not.toContain("launchCommand");
    expect(serialized).not.toContain("executablePath");
    expect(serialized).not.toContain("arguments");
    expect(textOf(evidence)).not.toMatch(/SENTINEL_|executablePath|launchCommand/);
  });
});

import { describe, expect, test } from "bun:test";

describe("tldr mini-markup", () => {
  test("renders *strong*, `mono`, !alert! runs into classed spans", async () => {
    const { withDom } = await import("./helpers/fake-dom");
    // @ts-expect-error dependency-free browser client has no declaration file
    const { tldrMarkupNodes } = await import("../src/web/tldr-markup.js");
    const nodes = withDom(() => tldrMarkupNodes("agent *blocked* on `main` — !needs you!"));
    const tags = nodes.map((n: any) => n.tagName + ":" + (n.className || ""));
    expect(tags).toEqual(["span:", "strong:", "span:", "span:mono", "span:", "span:is-alert"]);
    expect(nodes.map((n: any) => n.textContent).join("")).toBe("agent blocked on main — needs you");
  });

  test("HTML in writer text renders as literal text, never as elements", async () => {
    const { withDom } = await import("./helpers/fake-dom");
    // @ts-expect-error dependency-free browser client has no declaration file
    const { tldrMarkupNodes } = await import("../src/web/tldr-markup.js");
    const hostile = 'x <img src=q onerror="alert(1)"> *<script>y</script>*';
    const nodes = withDom(() => tldrMarkupNodes(hostile));
    for (const n of nodes as any[]) expect(["SPAN", "STRONG"]).toContain(n.tagName.toUpperCase());
    expect(nodes.map((n: any) => n.textContent).join("")).toContain('<img src=q onerror="alert(1)">');
  });
});

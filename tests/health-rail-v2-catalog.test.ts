import { expect, test } from "bun:test";

test("TLDR_VIEW_KEY is exported for per-browser view persistence", async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  const { TLDR_VIEW_KEY } = await import("../src/web/client-catalogs.js");
  expect(TLDR_VIEW_KEY).toBe("mtn3-tldr-view");
});

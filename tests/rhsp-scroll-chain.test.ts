import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf8");

function ruleFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || "";
}

test("RHSP nested transcript releases wheel scrolling at its boundaries", () => {
  const transcript = ruleFor(".drawer-chat-scroll");

  expect(transcript).toMatch(/overflow-y:\s*auto/);
  expect(transcript).toMatch(/overscroll-behavior:\s*auto/);
  expect(transcript).not.toMatch(/overscroll-behavior:\s*contain/);

  // The drawer itself still owns full-sheet containment. Only the nested reading
  // surface releases boundary input so the parent/page can continue scrolling.
  expect(ruleFor(".pane-inspector")).toMatch(/overscroll-behavior:\s*contain/);

  // On desktop the document is the outer scroll owner. The agent pane must not
  // terminate a wheel released by its nested transcript surface.
  expect(styles).toMatch(
    /@media\s*\(min-width:\s*1025px\)\s*\{[\s\S]*?\.dw-agent\.pane-inspector\s*\{[^}]*overscroll-behavior:\s*auto/,
  );
});

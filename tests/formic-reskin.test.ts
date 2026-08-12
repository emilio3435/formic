import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const pathFor = (...parts: string[]) => join(ROOT, ...parts);
const read = (...parts: string[]) => readFileSync(pathFor(...parts), "utf8");

function cssRule(source: string, selector: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((match) => match[1].split(",").some((part) => part.trim() === selector))
    .map((match) => match[2])
    .join("\n");
}

describe("Formic reskin RED contracts", () => {
  test("[FORMIC-TOKENS-ASSETS-RED] canonical tokens, mark, and reference guide are vendored", () => {
    const tokensPath = pathFor("src/web/formic-tokens.css");
    const markPath = pathFor("src/web/icons/formic-mark.svg");
    const guidePath = pathFor("docs/design/formic/formic-tokens-guide.md");
    const html = read("src/web/index.html");

    expect(existsSync(tokensPath), "FORMIC-TOKENS-ASSETS-RED: src/web/formic-tokens.css is required").toBe(true);
    expect(existsSync(markPath), "FORMIC-TOKENS-ASSETS-RED: src/web/icons/formic-mark.svg is required").toBe(true);
    expect(existsSync(guidePath), "FORMIC-TOKENS-ASSETS-RED: docs/design/formic/formic-tokens-guide.md is required").toBe(true);

    const faviconHref = html.match(/<link\b[^>]*\brel=["'][^"']*icon[^"']*["'][^>]*\bhref=["']([^"']*favicon\.svg(?:\?[^"']*)?)["'][^>]*>/i)?.[1] ?? "";
    expect(faviconHref, "FORMIC-TOKENS-ASSETS-RED: index.html must link same-origin favicon.svg").toMatch(
      /^(?:\.\/|\/)?favicon\.svg(?:\?.*)?$/,
    );
    expect(faviconHref, "FORMIC-TOKENS-ASSETS-RED: favicon must not use a remote URL").not.toMatch(
      /^(?:[a-z][a-z\d+.-]*:|\/\/)/i,
    );

    if (!existsSync(tokensPath)) return;
    const tokenHref = html.match(/<link\b[^>]*\bhref=["']([^"']*formic-tokens\.css(?:\?[^"']*)?)["'][^>]*>/i)?.[1] ?? "";
    expect(tokenHref, "FORMIC-TOKENS-ASSETS-RED: index.html must link same-origin formic-tokens.css").toMatch(
      /^(?:\.\/|\/)?formic-tokens\.css(?:\?.*)?$/,
    );
    expect(tokenHref, "FORMIC-TOKENS-ASSETS-RED: token stylesheet must not use a remote URL").not.toMatch(
      /^(?:[a-z][a-z\d+.-]*:|\/\/)/i,
    );
    const tokens = read("src/web/formic-tokens.css");
    for (const token of [
      "--color-surface-canvas",
      "--color-surface-card",
      "--color-brand-primary",
      "--color-interactive",
      "--color-focus-ring",
      "--color-status-success",
      "--color-status-warning",
      "--color-status-danger",
      "--color-status-info",
    ]) {
      expect(tokens, `FORMIC-TOKENS-ASSETS-RED: missing semantic token ${token}`).toContain(token);
    }
    expect(tokens).toMatch(/--clay-500\s*:\s*#c1632b/i);
    expect(tokens).toMatch(/--indigo-500\s*:\s*#5b4fd1/i);
    expect(tokens).toMatch(/--color-brand-primary\s*:\s*var\(--clay-500\)/);
    expect(tokens).toMatch(/--color-status-danger\s*:\s*var\(--red-500\)/);
    expect(tokens).toMatch(/--color-status-success-text\s*:\s*var\(--green-700\)/);
    expect(tokens).toMatch(/--color-status-warning-text\s*:\s*var\(--amber-700\)/);
    expect(tokens).toMatch(/--color-status-danger-text\s*:\s*var\(--red-600\)/);
    expect(tokens).toMatch(/--color-status-info-text\s*:\s*var\(--blue-600\)/);
    expect(tokens).toMatch(/--color-brand-control\s*:\s*var\(--clay-600\)/);
    expect(tokens).toMatch(/--color-brand-control-hover\s*:\s*var\(--clay-700\)/);

    const styles = read("src/web/styles.css");
    expect(styles, "FORMIC-TOKENS-ASSETS-RED: body bridge must keep readable secondary text").toMatch(
      /--body\s*:\s*var\(--color-text-secondary\)/,
    );
    expect(styles, "FORMIC-TOKENS-ASSETS-RED: faint bridge must keep readable secondary text").toMatch(
      /--faint\s*:\s*var\(--color-text-secondary\)/,
    );
    expect(styles, "FORMIC-TOKENS-ASSETS-RED: component CSS must not consume legacy --clay").not.toMatch(
      /var\(--clay\)/,
    );
    expect(styles, "FORMIC-TOKENS-ASSETS-RED: ended ink must be defined separately from brand clay").toMatch(
      /--ended-ink\s*:\s*var\(--gray-500\)/,
    );
  });

  test("[FORMIC-MASTHEAD-WORDMARK-LIVE-RED] Formic lockup and LIVE use their assigned roles", () => {
    const html = read("src/web/index.html");
    const styles = read("src/web/styles.css");
    const markHref = html.match(/(?:src|href)=["']([^"']*formic-mark\.svg(?:\?[^"']*)?)["']/i)?.[1] ?? "";

    expect(
      /^(?:\.\/|\/)?icons\/formic-mark\.svg(?:\?.*)?$/.test(markHref),
      "FORMIC-MASTHEAD-WORDMARK-LIVE-RED: masthead must use the same-origin Formic mark",
    ).toBe(true);
    expect(markHref, "FORMIC-MASTHEAD-WORDMARK-LIVE-RED: mark must not use a remote URL").not.toMatch(
      /^(?:[a-z][a-z\d+.-]*:|\/\/)/i,
    );
    expect(
      /<h1[^>]*>\s*Form\s*<span[^>]*class=["'][^"']*wm-accent[^"']*["'][^>]*>\s*i\s*<\/span>\s*c\s*<\/h1>/s.test(html),
      "FORMIC-MASTHEAD-WORDMARK-LIVE-RED: wordmark must be Form<span class=wm-accent>i</span>c",
    ).toBe(true);

    const wordmark = cssRule(styles, ".wordmark h1");
    expect(wordmark, "FORMIC-MASTHEAD-WORDMARK-LIVE-RED: wordmark must use the display family").toMatch(
      /font-family\s*:\s*var\(--font-display\)/,
    );
    expect(wordmark, "FORMIC-MASTHEAD-WORDMARK-LIVE-RED: wordmark weight must be Syne 800").toMatch(
      /font-weight\s*:\s*800/,
    );
    const accent = cssRule(styles, ".wm-accent");
    expect(accent, "FORMIC-MASTHEAD-WORDMARK-LIVE-RED: only the i receives brand clay").toMatch(
      /color\s*:\s*var\(--color-brand-primary\)/,
    );

    const live = cssRule(styles, ".conn-live");
    const liveDot = cssRule(styles, ".conn-live .conn-dot");
    expect(live, "FORMIC-MASTHEAD-WORDMARK-LIVE-RED: LIVE label must use accessible success text, never clay").toMatch(
      /color\s*:\s*var\(--color-status-success-text\)/,
    );
    expect(liveDot, "FORMIC-MASTHEAD-WORDMARK-LIVE-RED: LIVE dot must use status success").toMatch(
      /background\s*:\s*var\(--color-status-success\)/,
    );
  });

  test("[FORMIC-TLDR-HIERARCHY-RED] TL;DR gets a readable label and explicit attention count", () => {
    const styles = read("src/web/styles.css");
    const app = read("src/web/app.js");

    const label = cssRule(styles, ".heartbeat-tldr-label");
    expect(label, "FORMIC-TLDR-HIERARCHY-RED: TL;DR label must use Inter UI text").toMatch(
      /font-family\s*:\s*var\(--font-ui\)/,
    );
    expect(label, "FORMIC-TLDR-HIERARCHY-RED: TL;DR label must be 1.05-1.15rem").toMatch(
      /font-size\s*:\s*1\.(?:0[5-9]|1[0-5])rem/,
    );
    expect(label, "FORMIC-TLDR-HIERARCHY-RED: TL;DR label must use shipped Inter 600").toMatch(
      /font-weight\s*:\s*600/,
    );

    const count = cssRule(styles, ".tldr-attention-count");
    expect(count, "FORMIC-TLDR-HIERARCHY-RED: attention counter class is required").not.toBe("");
    expect(count, "FORMIC-TLDR-HIERARCHY-RED: attention counter must be tabular mono").toMatch(
      /font-family\s*:\s*var\(--font-mono\)/,
    );
    expect(count, "FORMIC-TLDR-HIERARCHY-RED: attention counter must declare tabular numerals").toMatch(
      /font-variant-numeric\s*:\s*tabular-nums/,
    );
    expect(count, "FORMIC-TLDR-HIERARCHY-RED: attention counter must use accessible warning text").toMatch(
      /var\(--color-status-warning-text\)/,
    );

    const lane = cssRule(styles, ".health-tldr-lane");
    expect(lane, "FORMIC-TLDR-HIERARCHY-RED: TL;DR lane must use the white card surface").toMatch(
      /background\s*:\s*var\(--color-surface-card\)/,
    );
    expect(lane, "FORMIC-TLDR-HIERARCHY-RED: TL;DR lane must retain a Formic hairline").toMatch(
      /border(?:-(?:left|right|top|bottom))?\s*:[^;]*var\(--color-border-default\)/,
    );
    const needsYou = cssRule(styles, ".health-tldr-lane.is-needs-you");
    expect(needsYou, "FORMIC-TLDR-HIERARCHY-RED: TL;DR needs-you rail must be warning, not brand").toMatch(
      /var\(--color-status-warning\)/,
    );
    for (const selector of [".tldr-proof-row:focus-visible", ".tldr-card-repo:focus-visible"]) {
      expect(cssRule(styles, selector), `FORMIC-TLDR-HIERARCHY-RED: ${selector} must use indigo focus`).toMatch(
        /var\(--color-interactive\)|var\(--color-focus-ring\)/,
      );
    }
    expect(
      app.includes("tldr-attention-count"),
      "FORMIC-TLDR-HIERARCHY-RED: renderHealthTldrLane must emit the attention counter",
    ).toBe(true);
  });

  test("[FORMIC-DASHBOARD-SURFACES-RED] dashboard surfaces keep white cards and semantic separation", () => {
    const styles = read("src/web/styles.css");
    for (const selector of [
      ".readings-stack",
      ".ops-stage",
      ".program",
      ".repo-section",
      ".pane-inspector",
      ".drawer-chat",
      ".settings-inner",
      ".notify-panel",
    ]) {
      const rule = cssRule(styles, selector);
      expect(rule, `FORMIC-DASHBOARD-SURFACES-RED: ${selector} must use the white card surface`).toMatch(
        /background\s*:\s*var\(--color-surface-card\)/,
      );
      expect(rule, `FORMIC-DASHBOARD-SURFACES-RED: ${selector} must use a semantic border`).toMatch(
        /border(?:-[^:]+)?\s*:[^;]*var\(--color-border-(?:default|subtle)\)/,
      );
    }
    expect(cssRule(styles, ".program"), "FORMIC-DASHBOARD-SURFACES-RED: program elevation must be semantic").toMatch(
      /box-shadow\s*:\s*var\(--shadow-(?:sm|md|lg)\)/,
    );
  });

  test("[FORMIC-ROLE-STATUS-RED] role tags use classification aliases while status rails stay operational", () => {
    const styles = read("src/web/styles.css");
    const roleRules = [
      ".role-orchestrator", ".role-human", ".role-monitor", ".role-worker", ".role-service",
      ".role-frontend", ".role-backend", ".role-verifier", ".role-tester", ".role-automation",
    ];
    for (const selector of roleRules) {
      const rule = cssRule(styles, selector);
      expect(rule, `FORMIC-ROLE-STATUS-RED: ${selector} must use a Formic tag alias`).toMatch(
        /var\(--tag-(?:slate|clay|indigo|amber)-(?:fg|bg)\)/,
      );
      expect(rule, `FORMIC-ROLE-STATUS-RED: ${selector} must not contain raw role colors`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
    const chip = cssRule(styles, ".role-chip");
    expect(chip, "FORMIC-ROLE-STATUS-RED: role chips must carry role aliases").toMatch(/var\(--role-(?:color|ink|surface)/);
    const needsRail = cssRule(styles, ".agent-row.is-needs-you:not(.is-selected)");
    expect(needsRail, "FORMIC-ROLE-STATUS-RED: board blocker rails must remain danger status").toMatch(
      /var\(--color-status-danger(?:-text|-tint)?\)|var\(--needs\)/,
    );
    expect(needsRail, "FORMIC-ROLE-STATUS-RED: status rails must not consume role tags").not.toMatch(/var\(--tag-/);
  });

  test("[FORMIC-ACTIONS-RED] primary and ghost actions retain distinct semantic roles", () => {
    const styles = read("src/web/styles.css");
    const primary = cssRule(styles, ".btn.primary");
    expect(primary, "FORMIC-ACTIONS-RED: primary action fill must use accessible brand control").toMatch(
      /background\s*:\s*var\(--color-brand-control\)/,
    );
    expect(primary, "FORMIC-ACTIONS-RED: primary action text must be inverse brand text").toMatch(
      /color\s*:\s*var\(--color-text-on-brand\)/,
    );
    expect(cssRule(styles, ".btn.dw-ghost"), "FORMIC-ACTIONS-RED: advisory ghost text must use darker amber").toMatch(
      /color\s*:\s*var\(--color-status-warning-text\)/,
    );
    const base = cssRule(styles, ".btn");
    expect(base, "FORMIC-ACTIONS-RED: neutral controls must use a card surface").toMatch(
      /background\s*:\s*var\(--color-surface-card\)/,
    );
    expect(styles, "FORMIC-ACTIONS-RED: links must use the indigo text role").toMatch(
      /\.linkish\s*\{[^}]*color\s*:\s*var\(--color-text-link\)/s,
    );
  });

  test("[FORMIC-READINGS-TYPOGRAPHY-RED] readings keep UI labels and mono values", () => {
    const styles = read("src/web/styles.css");
    for (const selector of [".reading-label", ".reading-value", ".reading-sub", ".program-rollup-value", ".ri-value", ".usage-table td.usage-val"]) {
      const rule = cssRule(styles, selector);
      expect(rule, `FORMIC-READINGS-TYPOGRAPHY-RED: ${selector} must declare its Formic font role`).toMatch(
        /var\(--font-(?:ui|mono)\)/,
      );
    }
    expect(cssRule(styles, ".reading-label"), "FORMIC-READINGS-TYPOGRAPHY-RED: labels must remain readable").toMatch(
      /color\s*:\s*var\(--color-text-secondary\)/,
    );
    expect(cssRule(styles, ".reading-value"), "FORMIC-READINGS-TYPOGRAPHY-RED: values must use readable primary text").toMatch(
      /color\s*:\s*var\(--color-text-primary\)/,
    );
  });

  test("[FORMIC-INVERSE-TEXT-RED] inverse chat text uses named accessibility aliases", () => {
    const tokens = read("src/web/formic-tokens.css");
    const styles = read("src/web/styles.css");
    for (const token of ["--color-text-on-inverse", "--color-text-on-inverse-strong", "--color-text-on-inverse-muted"]) {
      expect(tokens, `FORMIC-INVERSE-TEXT-RED: missing ${token}`).toContain(token);
    }
    expect(cssRule(styles, '.chat-msg[data-role="user"] .chat-msg-body'), "FORMIC-INVERSE-TEXT-RED: user body must use inverse text").toMatch(
      /color\s*:\s*var\(--color-text-on-inverse\)/,
    );
    expect(cssRule(styles, '.chat-msg[data-role="user"] .chat-msg-role'), "FORMIC-INVERSE-TEXT-RED: user role must use strong inverse text").toMatch(
      /color\s*:\s*var\(--color-text-on-inverse-strong\)/,
    );
    expect(cssRule(styles, '.chat-msg[data-role="user"] .chat-msg-meta'), "FORMIC-INVERSE-TEXT-RED: user metadata must use muted inverse text").toMatch(
      /color\s*:\s*var\(--color-text-on-inverse-muted\)/,
    );
    expect(styles, "FORMIC-INVERSE-TEXT-RED: component CSS must not use raw white literals for chat text").not.toMatch(
      /\.chat-msg\[data-role="user"\][^{}]*\{[^}]*#[fF]{3,6}/s,
    );
  });

  test("[FORMIC-FOCUS-RED] every focus-visible rule uses the indigo interaction role", () => {
    const styles = read("src/web/styles.css");
    const focusRules = [...styles.matchAll(/([^{}]*:focus-visible)\s*\{([^}]*)\}/g)];

    expect(focusRules.length, "FORMIC-FOCUS-RED: focus-visible coverage must exist").toBeGreaterThan(0);
    for (const [, selector, body] of focusRules) {
      expect(body, `FORMIC-FOCUS-RED: ${selector.trim()} must use --color-interactive or --color-focus-ring`).toMatch(
        /var\(--color-(?:interactive|focus-ring)\)/,
      );
      expect(body, `FORMIC-FOCUS-RED: ${selector.trim()} must not use status or brand clay`).not.toMatch(
        /var\(--(?:ember|color-brand-primary)\)/,
      );
    }
  });

  test("[FORMIC-RENAME-RED] user-facing product identity is Formic", async () => {
    const html = read("src/web/index.html");
    const app = read("src/web/app.js");
    const apiClient = read("src/web/api-client.js");
    const catalogs = read("src/web/client-catalogs.js");
    const notificationsSource = read("src/web/notifications.js");
    const title = html.match(/<title>\s*([^<]+?)\s*<\/title>/)?.[1] ?? "";

    expect(title, "FORMIC-RENAME-RED: page title must read Formic").toBe("Formic — operator console");
    expect(html, "FORMIC-RENAME-RED: masthead h1 must read Formic").toMatch(
      /<h1[^>]*>\s*Form\s*<span[^>]*>\s*i\s*<\/span>\s*c\s*<\/h1>/s,
    );
    expect(html, "FORMIC-RENAME-RED: old product wordmark must be gone from the h1").not.toMatch(
      /<h1[^>]*>[^<]*The Ant(?:&nbsp;|\s+)Hill[^<]*<\/h1>/s,
    );
    expect(apiClient, "FORMIC-RENAME-RED: connection failure copy must use the Formic identity").toContain(
      '"Check that the Formic server is running "',
    );
    expect(apiClient, "FORMIC-RENAME-RED: connection failure copy must not expose the old identity").not.toContain(
      "Ant Hill server",
    );
    expect(catalogs, "FORMIC-RENAME-RED: lifecycle explanation copy must use the Formic identity").toContain(
      "Formic cannot tell whether this session is still alive.",
    );
    expect(
      /baseTitle\s*=\s*document\.title/.test(app),
      "FORMIC-RENAME-RED: notification title base must be captured from the document title",
    ).toBe(true);
    expect(
      /document\.title\s*=\s*titleWithAlerts\(\s*state\.notify\.baseTitle\s*\|\|\s*document\.title\s*,\s*next\.length\s*\)/.test(notificationsSource),
      "FORMIC-RENAME-RED: notification updates must derive from the captured document-title base",
    ).toBe(true);

    // Keep the pure title decoration contract stable while the base identity changes.
    // The production module is intentionally plain JavaScript; keep this runtime
    // contract without widening the repository's TypeScript include fence.
    // @ts-expect-error TS7016: notifications.js has no declaration file by design.
    const { titleWithAlerts } = await import("../src/web/notifications.js");
    expect(titleWithAlerts(title, 3)).toBe("(3) " + title);
    expect(titleWithAlerts(title, 0)).toBe(title);
    expect(titleWithAlerts(titleWithAlerts(title, 3), 2)).toBe("(2) " + title);
    expect(titleWithAlerts(titleWithAlerts(title, 3), 0)).toBe(title);
  });

  test("[FORMIC-CSP-FONTS-RED] local font faces and WOFF2 serving preserve the strict CSP", () => {
    const fontDir = pathFor("src/web/fonts");
    const server = read("src/server/app.ts");
    const html = read("src/web/index.html");
    const tokenPath = pathFor("src/web/formic-tokens.css");
    const fontsCssPath = pathFor("src/web/fonts.css");

    expect(existsSync(fontDir), "FORMIC-CSP-FONTS-RED: src/web/fonts must be present for self-hosting").toBe(true);
    if (!existsSync(fontDir)) return;
    const woff2 = readdirSync(fontDir).filter((name) => name.endsWith(".woff2"));
    expect(woff2.length, "FORMIC-CSP-FONTS-RED: at least one local WOFF2 must be vendored").toBeGreaterThan(0);

    const fontCss = [
      existsSync(tokenPath) ? read("src/web/formic-tokens.css") : "",
      existsSync(fontsCssPath) ? read("src/web/fonts.css") : "",
    ].join("\n");
    const faces = [...fontCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]);
    const faceCovers = (body: string, weight: number) => {
      const declaration = body.match(/font-weight\s*:\s*([^;]+)/)?.[1] ?? "";
      const weights = [...declaration.matchAll(/\d+/g)].map((match) => Number(match[0]));
      return weights.includes(weight)
        || (weights.length >= 2 && weight >= Math.min(...weights) && weight <= Math.max(...weights));
    };
    for (const [family, weights] of [
      ["Syne", [700, 800]],
      ["Inter", [400, 500, 600]],
      ["JetBrains Mono", [400, 500]],
    ] as const) {
      for (const weight of weights) {
        expect(
          faces.some((body) => body.includes(family) && faceCovers(body, weight)),
          `FORMIC-CSP-FONTS-RED: local @font-face for ${family} ${weight} is required`,
        ).toBe(true);
      }
    }
    expect(fontCss, "FORMIC-CSP-FONTS-RED: font faces must point at same-origin WOFF2 files").toMatch(
      /src\s*:\s*url\(\s*["']?(?!https?:)[^)]*\.woff2["']?\s*\)/,
    );
    expect(server, "FORMIC-CSP-FONTS-RED: static server must map WOFF2 to font/woff2").toContain(
      '".woff2": "font/woff2"',
    );
    expect(server, "FORMIC-CSP-FONTS-RED: strict self-only style CSP must remain pinned").toContain(
      "style-src 'self'; script-src 'self'",
    );
    expect(html, "FORMIC-CSP-FONTS-RED: HTML must not hotlink Google Fonts").not.toMatch(
      /https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)/,
    );
  });

  test("[FORMIC-NOTIFICATION-STATUS-RED] notification tones keep person-blocked danger separate from warning", () => {
    const styles = read("src/web/styles.css");
    const notifications = read("src/web/notifications.js");

    expect(
      notifications.includes('blocked: "is-blocked", noticed: "is-noticed", clear: "is-clear"'),
      "FORMIC-NOTIFICATION-STATUS-RED: blocked/noticed/clear badge states must remain wired",
    ).toBe(true);
    const blocked = cssRule(styles, ".notify-badge.is-blocked");
    expect(blocked, "FORMIC-NOTIFICATION-STATUS-RED: blocked badge must use danger status").toMatch(
      /background\s*:\s*var\(--color-status-danger\)/,
    );
    expect(blocked, "FORMIC-NOTIFICATION-STATUS-RED: blocked badge text must use the on-brand text token").toMatch(
      /color\s*:\s*var\(--color-text-on-brand\)/,
    );
    const noticed = cssRule(styles, ".notify-badge.is-noticed");
    expect(noticed, "FORMIC-NOTIFICATION-STATUS-RED: noticed-only badge must use warning status").toMatch(
      /color\s*:\s*var\(--color-status-warning-text\)/,
    );
    const clear = cssRule(styles, ".notify-badge.is-clear");
    expect(clear, "FORMIC-NOTIFICATION-STATUS-RED: clear badge must use readable secondary text").toMatch(
      /color\s*:\s*var\(--color-text-secondary\)/,
    );
    expect(blocked, "FORMIC-NOTIFICATION-STATUS-RED: brand clay must never mean person-blocked").not.toMatch(
      /var\(--(?:clay|color-brand-primary)/,
    );
  });

  test("[FORMIC-INTERACTION-RED] the louder TL;DR head preserves existing anchors and facet actions", () => {
    const html = read("src/web/index.html");
    const app = read("src/web/app.js");
    const allLaneStart = app.indexOf("function renderTldrAllLane");
    const repoLaneStart = app.indexOf("function renderTldrRepoLane");
    const allLane = allLaneStart >= 0 && repoLaneStart > allLaneStart
      ? app.slice(allLaneStart, repoLaneStart)
      : "";

    for (const [id, anchor] of [
      ["notify-toggle", 'aria-controls="notifications-panel"'],
      ["settings-toggle", 'aria-controls="settings-panel"'],
      ["conn-badge", 'id="conn-badge"'],
      ["conn-label", 'id="conn-label"'],
      ["server-health", 'id="server-health"'],
      ["cleanup-status", 'role="status" aria-live="polite"'],
    ] as const) {
      const tag = html.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`))?.[0] ?? "";
      expect(tag, `FORMIC-INTERACTION-RED: ${id} anchor must survive the reskin`).toContain(`id="${id}"`);
      expect(tag, `FORMIC-INTERACTION-RED: ${id} anchor must retain its relationship`).toContain(anchor);
    }
    expect(
      app.includes('$("notify-toggle").addEventListener("click"'),
      "FORMIC-INTERACTION-RED: Notifications click wiring must survive the reskin",
    ).toBe(true);
    expect(
      app.includes('$("settings-toggle").addEventListener("click"'),
      "FORMIC-INTERACTION-RED: Settings click wiring must survive the reskin",
    ).toBe(true);
    expect(app.includes("setTldrView"), "FORMIC-INTERACTION-RED: TL;DR paging helper must remain").toBe(true);
    expect(app.includes("filterBoardToTldrRepo"), "FORMIC-INTERACTION-RED: proof rows/chips must filter the board without paging the header").toBe(true);
    expect(
      app.includes('grid.textContent = ""'),
      "FORMIC-INTERACTION-RED: cleanup live region must remain outside the readings paint",
    ).toBe(true);

    expect(
      allLane.includes("tldr-attention-count"),
      "FORMIC-INTERACTION-RED: attention count must be added without removing TL;DR facet actions",
    ).toBe(true);
    expect(
      allLane.includes("filterBoardToTldrRepo"),
      "FORMIC-INTERACTION-RED: ALL-lane proof rows/chips must filter the board, not page the fleet TL;DR",
    ).toBe(true);
    expect(
      allLane.includes("setTldrView"),
      "FORMIC-INTERACTION-RED: ALL-lane must not page the dossier from proof rows, chips, or the next chevron",
    ).toBe(false);
  });
});

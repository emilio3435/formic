# Apply the Formic design system to this repo

## Context

This repo currently ships a functional-but-generic dashboard UI (previously "The Ant Hill", rebranding to **Formic**). A design pass has produced a finalized token system, a wordmark/mark direction, and a white-background, hairline-border visual language. Your job is to wire this into the actual codebase without breaking any existing functionality — this is a reskin, not a redesign of the layout or information architecture.

Reference files in this same folder:
- `formic-tokens.css` — canonical design tokens, two-tier (raw primitives -> semantic aliases like `--color-brand-primary`, `--color-status-danger`)
- `formic-tokens-guide.md` — usage rules: which color role goes where, contrast requirements, best practices. **Read this and `formic-brand-guidelines.html` before writing any styles.**
- `formic-preview.html` — static reference mockup showing the tokens applied to a header, a stat-card row, agent list rows, and classification tags
- `formic-brand-guidelines.html` — the full brand system: positioning, principles, voice, colour roles, type scale, surfaces, components, motion, accessibility
- `formic-logo-book.html` — mark construction geometry, clear space, minimum sizes, lockups, colorways, misuse, asset checklist
- `formic-wordmark.html` — wordmark + mark specimen: lockups, tilt options, colorways, and behavior at favicon sizes
- `formic-mark.svg` — the mark itself, production-ready, with inline comments
- `supplementary-ideas.md` — optional extra ideas (idle/empty states, tunnel-style tree nav, role glyphs) — nice-to-haves, not required

## Tasks, in order

1. **Detect the project's styling system first** — Tailwind config, plain CSS custom properties, styled-components/emotion, CSS Modules, etc. — before writing anything. Adapt the token delivery mechanism to match what's already there rather than introducing a second styling paradigm.

2. **Port every token in `formic-tokens.css`** into that system: as `:root` CSS custom properties if the project already uses plain CSS/vars, or as an extended Tailwind theme (`colors`, `fontFamily`, `borderRadius`, `boxShadow`) if it's Tailwind, etc. Preserve the two-tier structure — both primitives and semantic aliases need to exist, named consistently with the source file, so future work references `color-brand-primary` etc. rather than raw hex values.

3. **Add font loading** for Syne (weights 700/800, wordmark/display use only), Inter (400/500/600, all other UI text), and JetBrains Mono (400/500, data/paths/metrics/IDs). Use the project's existing font-loading convention (next/font, self-hosted `@font-face`, etc.) rather than hotlinking the Google Fonts CDN if the project already has a font pipeline.

4. **Rename the product** from "The Ant Hill" to "Formic" everywhere it's user-facing: page title, header wordmark, favicon, settings/about copy, README. Leave internal identifiers, package names, and code symbols alone unless asked.

5. **Build the mark** as a reusable SVG/icon component from `formic-mark.svg` — a 18°-tilted isosceles triangle, clay-filled nodes on indigo edges, with a signal pulse circulating the perimeter. That file has inline comments for the static variant, favicon sizing, and the reduced-motion fallback. Generate favicon sizes from the static variant (16px needs the thickened stroke weight noted in the file).

6. **Rebuild the header** to match `formic-wordmark.html` and `formic-preview.html`: mark + Syne 800 wordmark on the left, set as `Form<span>i</span>c` where the "i" is `--color-brand-primary` (clay) and the rest is `--color-text-primary`; icon buttons and a pulsing LIVE status pill (uses the success/green token, never brand clay) on the right. The clay "i" is the only color break in the logotype — do not color additional letters.

7. **Apply the token system to the rest of the panel** — summary/stat cards, agent board rows, status pills, and role/classification tags — following the three-color-role rule in the guide:
   - **Brand (clay)** = identity only: logo, primary buttons, active nav.
   - **Interactive (indigo)** = focus rings, links, hover/selected states.
   - **Status (green/amber/red/blue)** = live/waiting/blocked/info only, never reused decoratively.
   Surfaces stay white; use border + shadow tokens for separation, never gray fills, per the guide's "Apple-esque" rule.

8. **Wire focus-visible states** across every interactive element to the indigo interactive token / `--color-focus-ring`. Don't ship browser-default blue outlines, and don't remove focus rings.

9. **Verify before calling it done**: run the app, screenshot the header, a stat-card row, and an agent list with mixed statuses. Confirm every existing interaction still works (agent selection, filters, tree nav, search). Check any new text/background color pairing you introduce against WCAG AA (4.5:1) — the guide has the ones already vetted.

10. **Don't invent a third brand hue.** If a new UI case doesn't map cleanly to an existing semantic token, flag it in your summary rather than picking an arbitrary color.

## Constraints

- Preserve the current information density — nothing about the board's layout, data, or interaction model should change, only its visual surface.
- If the codebase is large, ship incrementally: tokens + header first as one reviewable commit, then propagate to cards/rows/tags in follow-ups, rather than one giant diff.
- When done, summarize what you changed, what you skipped/flagged, and attach the three verification screenshots from step 9.

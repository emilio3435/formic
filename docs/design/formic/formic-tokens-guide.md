# Formic design tokens — how to apply them

`formic-tokens.css` is the source of truth. This is the usage guide: what each layer is for and the rules that keep a two-color-plus-status palette from turning into visual noise once it's spread across an entire panel, not just a header.

## The two-tier structure

Primitives (`--gray-500`, `--clay-500`, `--indigo-500`...) are raw values. Nothing in your components should reference a primitive directly — components reference semantic tokens (`--color-text-primary`, `--color-brand-primary`, `--color-status-danger`). The indirection is the whole point: when you eventually want a dark theme, you only remap the ~25 semantic tokens, not every place a hex code got typed into a component.

## The three color roles, and why they stay separated

This is the rule most worth enforcing as the palette spreads past the header: **brand, interactive, and status are three different jobs, and no color is allowed to do two of them.**

- **Brand (clay + indigo)** — identity only. The Formic mark, the logotype, a primary button, a selected/active nav item. If you're tempted to use clay to mean "this thing needs attention," stop — that's status's job.
- **Interactive (indigo)** — focus rings, links, hover/selected states on otherwise-neutral elements. Indigo doubles as brand secondary *and* interaction color on purpose — it's the "something responds to you" signal throughout the app.
- **Status (green / amber / red / blue)** — the only colors allowed to mean live/waiting/blocked/info. They're deliberately built from different hues than brand (clay is orange-leaning, danger-red is pink-leaning — glance-distinguishable even for the color-blind-adjacent, though you should still pair status color with an icon or label, never color alone).

If a future component wants a fourth "meaning," add a new semantic token and a new primitive scale — don't repurpose clay or indigo for it.

## Surfaces stay white — depth comes from border + shadow

This is the Apple-esque instruction made concrete: don't gray-fill a card to separate it from the page. Page canvas, cards, and panels are all `--color-surface-canvas` / `--color-surface-card` (both pure white). Separation comes from `--color-border-default` (a 1px hairline) plus `--shadow-sm` or `--shadow-md`. Reserve `--color-surface-subtle` (the one off-white, `--gray-50`) for things that are genuinely secondary to a card — a hover row, an inline code block, a nested sub-panel — never for a whole page section, or you'll end up with the "gray card on gray page" look this was meant to avoid.

## Applying it beyond the header

- **Header / top ribbon** — brand mark + logotype in `--color-brand-primary` on `--color-text-primary`; LIVE-style indicators use `--color-status-success`, not brand clay, even though they sit next to the logo.
- **Summary / stat cards** (Burn, Context, Tokens, Health, Momentum) — white surface, hairline border, numbers in `--font-mono` for tabular alignment, card accent (if any) uses status tokens keyed to what the metric means (Health card in a bad state → `--color-status-danger-tint` background wash), not brand color.
- **Agent board rows / tree nav** — status pills use the status tokens exactly as today; role/classification tags use the `--tag-*` pairs (slate/clay/indigo/amber) so roles are visually distinct from status at a glance — a row can be simultaneously "Guard" (role, indigo or slate tag) and "Waiting · Alert" (status, red) without the two systems colliding.
- **Buttons** — primary action = `--color-brand-primary` fill, white text; secondary/ghost = neutral border + `--color-text-primary`; never a status color on a button unless the button's action *is* that status ("Resolve alert" can be red-ish; "Save" never should be).
- **Links & focus states** — always indigo (`--color-interactive` / `--color-focus-ring`), everywhere in the app, so "this is clickable" stays one consistent signal instead of drifting per screen.

## Contrast baseline

Every `-fg` token paired with its matching `-tint`/`-bg` token (e.g. `--tag-clay-fg` on `--tag-clay-bg`, `--color-status-danger` on `--color-status-danger-tint`) was picked to clear 4.5:1 for normal-size text. If you introduce a new tint/fg pair, hold it to the same bar — don't eyeball it, check it — this is the one place a "looks fine" palette silently becomes an accessibility issue at panel scale.

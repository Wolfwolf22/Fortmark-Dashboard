# FortMark dashboard — operative design & code contract

Read this before touching any feature. This document describes the implemented
foundation and the current shell/Home direction. It takes precedence over the
original build proposal in `docs/PLAN.md`, which records historical rationale.

## Brand, in one paragraph

FortMark is a disciplined Fort Lauderdale brokerage. Controlling idea (exact
wording, sentence case, comma, period): **Real estate, returned to its
profession.** Never use the retired tagline "Real Estate That Thinks." The UI
is a professional instrument: calm, structured, high-contrast, evidence-led.
No emojis, no exclamation marks, no hype. Buttons say what happens ("Save
changes"). Sentence case everywhere except Archivo Black display headings,
which are uppercase.

## Palette — strict monochrome

Use ONLY the semantic Tailwind tokens (they resolve per theme):

| Class | Meaning |
|---|---|
| `bg-background` | app ground (96% gray light / black dark) |
| `bg-card` | card surface (white light / 7% gray dark) |
| `text-foreground` | primary ink |
| `text-muted-foreground` | readable secondary ink (40% gray light / 64% gray dark) |
| `border-border` | quiet decorative hairlines (89% gray light / 15% gray dark) |
| `border-input` | visible control boundaries (54% gray light / 46% gray dark) |
| `bg-tint` | inset chips, tracks, hover surfaces |
| `bg-track` | progress tracks |
| `bg-primary text-primary-foreground` | black fill / white ink (inverted in dark) |
| `bg-accent` | hover wash |
| `bg-surface` | #333 dark panel accent (rare) |

**Never** hardcode hex colors, never use Tailwind palette colors (`bg-blue-500`,
`text-green-600`, `bg-gray-*` — all forbidden). Status color goes through
`<StatusPill tone>` / `text-status-*` tokens only, badge-sized only.

The brand primitives remain black, white, `--fm-gray: #8C8C8C`, and
`--fm-surface: #333333`. The neutral gray primitive is for the brand palette and
chart structure; **it is not the small-text color**. Text uses semantic ink
tokens so the light and dark themes can meet contrast requirements. Never fade
secondary text with opacity. Reserve the quiet `border` token for decoration;
fields and outlined buttons use `input` so their boundaries remain visible.

At the defined base surfaces, secondary ink exceeds 4.5:1 and input boundaries
exceed 3:1 in both themes. New tinted surfaces and token opacity modifiers need
their own contrast check; a token does not make every possible pairing accessible.

## Typography

- Archivo only. `font-sans` (body, weights 400–800 via `font-medium|semibold|bold`)
  and `font-display` (Archivo Black) — nothing else.
- Display headings: use the `.text-display` utility (uppercase, tight leading).
- Micro-labels: use `.text-micro` (11px uppercase secondary ink, wide tracking)
  for section eyebrows and table labels, not for every supporting sentence.
- Card titles: Archivo 600, 15px, sentence case, snug leading. Supporting
  descriptions use readable secondary ink with relaxed leading.
- Numerals in stats/tables: add `.tabular`.

## Components you MUST reuse (do not re-implement)

All in `components/ui/`: Button, Badge, Card, Input, Textarea, Label, Select,
DropdownMenu, Dialog, Sheet, Tooltip, Popover, Tabs, Table, Switch, Checkbox,
Separator, Skeleton, ScrollArea, Command, Kbd, Segmented, PillProgress,
StatusPill (+ `LISTING_STATUS_PILL` map), DeltaBadge, EmptyState.

Charts: `ChartFrame`, `ChartTooltipFrame`, `chartColor()` in
`components/charts/chart-frame.tsx`; `Sparkline`; `CountUp`.
Widgets: `WidgetCard` + `useWidgetExpanded()` in `components/widgets/widget-card.tsx`.
Home period wiring: `useWidgetPeriod(id)` in `components/home/use-widget-period.ts`.
Transaction drawer (shared): `components/transactions/transaction-drawer.tsx`
with props `{ transactionId, open, onOpenChange }`.

## Data access — adapters only

Components never import from `lib/data/mock/*`. Use the adapters in
`lib/data/adapters/*` through the `useQuery` hook (`lib/data/hooks.ts`):

```tsx
const { range, preset } = /* page filter or useWidgetPeriod/useDateRange */;
const { data, loading } = useQuery(
  () => getTransactions(filters, range),
  [preset, range.from.getTime(), range.to.getTime(), /* primitive filter deps */]
);
```

- Deps must be primitives (timestamps, strings), not object refs.
- Mutations (`create*`, `update*`) bump a version that auto-refetches all
  `useQuery` consumers — no manual cache work.
- The global period: `useDateRange()` (`lib/stores/date-range.ts`). Home
  widgets use `useWidgetPeriod(id)` instead (handles per-widget override).

## Charts — monochrome rules (from the dataviz method)

- Series colors: `chartColor("active" | "2" | "3" | "4" | "5")` only; grid
  `chartColor("grid")`. Active/highlighted series is black (white in dark).
- Donut/stacked segments: differentiate by lightness, 2px gap (`stroke` =
  card background, `strokeWidth` 2), legend with labels + percentages.
- One axis only, no dual-axis. Text (labels, values, legends) wears ink
  tokens, never series color. Tooltips via `ChartTooltipFrame`.
- Bars: rounded ends (`radius={[6,6,0,0]}`), thin (`maxBarSize` ~40),
  `isAnimationActive` fine (respect nothing extra — CSS handles reduced
  motion for DOM, keep Recharts animation subtle/150-400ms).
- ≥2 series → legend; single series → none (title names it).

## Interaction standards

- Loading: `Skeleton` blocks matching final layout, never spinners-only.
- Empty: `EmptyState` with a direction, e.g. "No leads in this period. Widen
  the range or add a lead."
- Errors: say what went wrong and how to fix it.
- Row click targets are real `<button>`/`<Link>` (keyboard reachable). NO
  dead `#` anchors anywhere; stubbed actions are buttons with visible result.
- Focus rings are global (`:focus-visible`): 2px monochrome ring and 2px offset;
  forced-colors mode also receives a visible system outline. Never remove focus
  treatment without an equally visible replacement.
- Shared buttons: default and icon 40px; large 44px; small and compact icon
  36px, with a 40px minimum on small screens. Icon-only buttons need an accessible
  name; tooltips supplement the name. Preserve touch targets when adding classes.
- Motion: 150–200ms ease-out for controls. Static cards do not lift or gain a
  deeper hover shadow; use a subtle surface change for an actual clickable item.
  Existing page-entry motion respects `prefers-reduced-motion`. Nothing bouncy.
- Dark mode must be checked for every screen: cards separate by border, not
  shadow; images/plates already work in both.

## Layout

- Page content lives inside `app/(app)/*` under the shared horizontal shell.
  Keep the existing FortMark logo and Archivo identity. Core destinations stay
  in primary navigation; secondary destinations stay in More. Search, New,
  notifications and account controls remain available without dominating content.
- Home opens with a compact, theme-aware editorial welcome row: a 36–48px
  greeting, actual date and role, and a slender attention summary. It is not a
  large black cover card. The approved tagline is not repeated on Home.
- The business snapshot follows with the reporting period at the upper right
  and four consistent metric cells. A cell that links to its underlying records
  is a real Link with visible keyboard focus. Each metric retains its source,
  coverage, and missing-data caveats; visual polish never changes its meaning.
- Keep core work widgets visible early in the page. Avoid oversized greetings,
  empty decorative bands, and repeated headings that push transactions and
  follow-ups out of view.
- Bento/cards: `rounded-card` (16px); inner panels/popovers `rounded-panel`
  (12px); controls `rounded-lg` or `rounded-md` (8px); composer 16px. Light cards
  use a restrained shadow and quiet edge; dark cards separate through borders.
- Shared cards and widgets use 20px insets. Widget headers use a compact 32px
  icon backing, sentence-case title, optional 11px period caption, and named
  period/expand controls. Titles may wrap instead of disappearing into ellipses.
  Expanded widgets preserve the same content and keyboard-accessible dialog.
- Tables: 13px, `.text-micro` headers, paginate past ~10-12 rows with a
  quiet "Showing x–y of z" + Previous/Next buttons.

## Copy checklist (every string you write)

sentence case · plain verbs · button = the action ("Add lead", "Save
changes") · no "!" · no emojis · no hype ("powerful", "amazing" forbidden) ·
errors: what + fix · empty states: direction. The tagline appears ONLY on
the login screen and README, exact: `Real estate, returned to its profession.`

# FortMark dashboard — operative design & code contract

Read this before touching any feature. It is the binding contract between the
foundation and every page build. `docs/PLAN.md` holds the rationale.

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
| `bg-background` | app ground (#F5F5F5 light / #000 dark) |
| `bg-card` | card surface (white / #111) |
| `text-foreground` | primary ink |
| `text-muted-foreground` | gray #8C8C8C labels/captions |
| `border-border` | hairlines (#EAEAEA / #262626) |
| `border-input` | field borders |
| `bg-tint` | inset chips, tracks, hover surfaces |
| `bg-track` | progress tracks |
| `bg-primary text-primary-foreground` | black fill / white ink (inverted in dark) |
| `bg-accent` | hover wash |
| `bg-surface` | #333 dark panel accent (rare) |

**Never** hardcode hex colors, never use Tailwind palette colors (`bg-blue-500`,
`text-green-600`, `bg-gray-*` — all forbidden). Status color goes through
`<StatusPill tone>` / `text-status-*` tokens only, badge-sized only.

## Typography

- Archivo only. `font-sans` (body, weights 400–800 via `font-medium|semibold|bold`)
  and `font-display` (Archivo Black) — nothing else.
- Display headings: use the `.text-display` utility (uppercase, tight leading).
- Micro-labels: use `.text-micro` (11px uppercase gray, wide tracking).
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
- Focus rings are global (`:focus-visible`) — do not disable outlines.
- Motion: 150–200ms ease-out; hover lift = `hover:shadow-card-hover` +
  optional `hover:-translate-y-0.5`. Nothing bouncy.
- Dark mode must be checked for every screen: cards separate by border, not
  shadow; images/plates already work in both.

## Layout

- Page content lives inside `app/(app)/*` under the shell (rail + top bar,
  already built). Pages render their content only — no page-level titles
  (the top bar shows the title) unless the design needs a section header.
- Bento/cards: `Card` (24px radius). Inner panels `rounded-panel` (16px).
- Tables: 13px, `.text-micro` headers, paginate past ~10-12 rows with a
  quiet "Showing x–y of z" + Previous/Next buttons.

## Copy checklist (every string you write)

sentence case · plain verbs · button = the action ("Add lead", "Save
changes") · no "!" · no emojis · no hype ("powerful", "amazing" forbidden) ·
errors: what + fix · empty states: direction. The tagline appears ONLY on
the login screen and README, exact: `Real estate, returned to its profession.`

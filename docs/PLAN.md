# FortMark Dashboard — build plan

Planned before code, per the brief. This document fixes the token system, the layout
system, the architecture seams, and the file ownership map. `docs/DESIGN-SYSTEM.md` is
the operative contract every feature is built against.

## 1. Token system

### 1.1 Brand primitives

The four FortMark tokens, verbatim from the brand system:

```css
--fm-black:   #000000;  /* authority */
--fm-white:   #FFFFFF;  /* clarity */
--fm-gray:    #8C8C8C;  /* structure */
--fm-surface: #333333;  /* dark panels only, never a primary */
```

### 1.2 Derived neutral tints

Neutrals derived by lightness only — no hue anywhere:

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `#F5F5F5` | `#000000` | app ground (cards float on it) |
| `card` | `#FFFFFF` | `#111111` | card surfaces |
| `foreground` | `#000000` | `#FFFFFF` | primary ink |
| `muted-foreground` | `#8C8C8C` | `#8C8C8C` | labels, captions, secondary ink |
| `border` | `#EAEAEA` | `#262626` | hairlines, card edges (dark mode) |
| `input` | `#E3E3E3` | `#2E2E2E` | field borders |
| `tint` | `#F5F5F5` | `#1A1A1A` | inset chips, user chat bubble, track fills |
| `track` | `#EAEAEA` | `#262626` | progress pill tracks |
| `surface` | `#333333` | `#333333` | dark panel accents |

Dark mode is designed, not inverted: black ground, `#111` cards separated by `#262626`
borders (shadows carry no weight on black), white ink, the same `#8C8C8C` structure gray.

### 1.3 Chart tokens (monochrome, per dataviz method)

Series are a lightness ramp, never hues. Adjacent steps ≥ ~18 L* apart, so identity
survives every CVD type (lightness is preserved under CVD) and normal vision trivially.

```
--chart-active:  #000000 (light) / #FFFFFF (dark)   — the highlighted series/bar
--chart-2:       #555555 / #C6C6C6
--chart-3:       #8C8C8C / #8C8C8C
--chart-4:       #C6C6C6 / #555555
--chart-5:       #E3E3E3 / #333333
--chart-grid:    #EAEAEA / #262626
```

Rules carried from the dataviz skill: one axis always; legends for ≥2 series; text wears
ink tokens, never series color; 2px surface gaps between donut segments and adjacent
bars; thin marks with small rounded data-ends; tooltips on everything hoverable.

### 1.4 Status colors (the one permitted exception)

Desaturated near-neutrals, used only in badge-sized status pills:

| Status | Light fg / bg | Dark fg / bg |
|---|---|---|
| good | `#4C6957` / `#EEF2EF` | `#9BB2A4` / `#161B18` |
| warn | `#7D6A43` / `#F4F1EA` | `#B3A379` / `#1B1913` |
| bad | `#8A5656` / `#F5EEEE` | `#BB9494` / `#1C1515` |

Every status pill also carries a label (and where useful an icon) — never color alone.

### 1.5 Typography

Archivo only (approved substitute for Sanomat Sans). Variable font 400–800 +
Archivo Black, self-hosted woff2 via `next/font/local` (no runtime font fetch).

| Role | Face | Treatment |
|---|---|---|
| Display / page titles | Archivo Black | uppercase, tracking `-0.01em`, leading 0.95 |
| Micro-labels | Archivo 600 | 11px, uppercase, tracking `0.1em`, gray |
| Card titles | Archivo 700 | 14–15px, sentence case |
| Headline figures | Archivo 700/800 | 28–40px, `tabular-nums` |
| Body | Archivo 400/500 | 14px; tables 13px |

Hierarchy from weight and spacing only. No second family loads anywhere.

### 1.6 Shape, elevation, motion

- Radii: cards 24px, inner panels 16px, controls 10–12px, pills 999px, composer 16px.
- Shadows (light): `0 1px 2px rgb(0 0 0 / .04), 0 8px 24px rgb(0 0 0 / .06)`;
  hover lift adds ~2px translateY and a deeper layer. Dark mode: borders, not shadows.
- Motion: 150–200ms ease-out hovers, number count-ups on load, smooth chart
  transitions. All gated behind `prefers-reduced-motion`. Nothing springs or bounces.
- Focus: visible 2px ring (black on light, white on dark) with 2px offset, everywhere.

## 2. Layout system

- **Rail** — fixed left, 64px icon-only; expands to 232px on hover or via pin toggle
  (persisted). Logomark at top. Nine nav items in the brief's order; bottom cluster:
  notifications bell (unread dot), Settings, avatar popover. Active item = solid black
  tile, white icon (inverted in dark). Tooltips when collapsed.
- **Top bar** — sticky, page title in Archivo Black uppercase; right: ⌘K search
  trigger, "New" menu (quick-create dialog wired to adapters), date-range selector
  (Today / Week / Month / Quarter / Year, default Month) feeding a global store that
  every widget and page reads.
- **Bento grid** — CSS grid, 12 columns ≥1280px, 6 at ≥1024, 2/1 below. Widget spans
  declared in a registry; order drag-reorderable via dnd-kit, persisted to
  `localStorage` (`fm.dashboard.layout.v1`).
- **Card anatomy** — header: 16px monochrome icon, title, period sublabel, small icon
  buttons (period menu, expand). Expand opens a working full-screen dialog rendering
  the same widget with an `expanded` context flag.

## 3. Architecture seams (swap-ready by design)

- `lib/data/types.ts` — all domain shapes. `lib/data/mock/` — seeded deterministic
  generators (mulberry32, fixed seed; no `Math.random` so SSR and client agree).
- `lib/data/adapters/<domain>.ts` — one file per domain (listings, transactions,
  leads, calendar, documents, agents, market, messages, notifications, search,
  reports). Async functions with simulated latency; components never import mock
  data directly. Swapping in MLS/Supabase = rewriting one adapter file per domain.
- Mutations (`create*`, `update*`) write the in-memory store and bump a version
  counter store so hooks refetch — the same shape a server mutation + revalidate has.
- `lib/ai/client.ts` — `sendMessage(messages, opts): AsyncIterable<string>` backed by
  `app/api/chat/route.ts`, a real streaming route with `// TODO: connect provider`.
- `app/(auth)/login` + `app/(app)/...` route groups; `middleware.ts` passes through
  with `// TODO: session check`; `lib/auth/session.ts` mock session.
- Suggestion chips live only in `lib/ai/suggestions.ts` (`SUGGESTIONS` array).

## 4. Imagery

No reliable runtime network in dev sandboxes, so listing "photos" are deterministic
monochrome architectural SVG plates generated at build-prep time into
`public/photos/` — line-drawn South Florida facades, on-brand, self-contained. The
`Listing.photos` field is a URL array, so real MLS media drops in via the adapter
with no component changes.

## 5. Critique against the brief (pre-build)

Walked the brief line by line; issues caught at plan time and their resolutions:

1. **"Date range actually re-filters every widget"** — risk: widgets reading static
  mock slices. Resolution: adapters take a `DateRange` argument; the `useDateRange`
  store is the only source of that argument; mock dates are spread across the full
  year so every preset visibly changes results.
2. **"Expand must work — not decorative"** — resolution: expand renders the widget's
  real content inside a full-screen dialog via shared `WidgetCard` context, not a copy.
3. **Two-tone pill counters** — black-on-gray pill progress per the reference, built
  as one `PillProgress` primitive so Home and Reports agree.
4. **Chip behavior** — fills composer and focuses caret at end, never auto-sends;
  empty `prompt` falls back to label. Enforced in one `applySuggestion` helper.
5. **No `#` links** — nav is real routes only; any stubbed action is a `button` with
  visible feedback, never an anchor to nowhere.
6. **Retired tagline** — "Real Estate That Thinks" appears nowhere; canonical line
  reproduced exactly once on login and once in the README, verified in review.
7. **Hydration** — seeded RNG + a fixed "now" anchor per load keep server and client
  markup identical; count-ups start post-mount.
8. **Recharts on React 19** — pinned versions verified at install; charts wrapped in
  one `ChartFrame` so theming and tooltips are consistent and monochrome.
9. **Keyboard end-to-end** — dnd-kit keyboard sensors on (grid reorder and kanban);
  dialogs/drawers trap focus via Radix; ⌘K palette fully keyboard-driven.
10. **Copy rules** — sentence-case buttons naming the action, no exclamation marks,
  no emojis, no hype; empty states direct; errors say what to fix.

## 6. Build order and ownership

1. Foundation (this plan, configs, tokens, fonts, types, mock data, adapters, ui
   primitives, layout shell, stores) — single-author, contracts fixed first.
2. Parallel feature agents, each owning disjoint paths: Home (grid+widgets in three
   slices), Transactions (incl. shared detail drawer), Listings, Leads, Calendar,
   Documents, Reports, Settings+Login+middleware, AI, Messages.
3. Verification: `tsc --noEmit`, `next build`, brand/interaction critics against the
   Definition of done, fixes, README, commit, push.

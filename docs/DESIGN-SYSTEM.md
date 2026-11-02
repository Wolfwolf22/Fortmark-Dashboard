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

## Surface depth and icon wells

- `shadow-card` is the shared static card elevation in both themes. It combines
  a small contact shadow, a broad ambient falloff and a restrained inset top edge.
  In dark mode the neutral border and inner highlight carry the separation;
  the shadow provides supporting depth. Do not add bespoke shadows to each card.
- `shadow-pop` gives dialogs and popovers a higher elevation than workspace
  cards. `shadow-card-hover` is reserved for an actual interactive surface;
  a static panel does not change elevation when the pointer crosses it.
  Small moving controls, such as switch thumbs, use a compact `shadow-sm`
  rather than a broad panel shadow.
- Use `IconWell` from `components/ui/icon-well.tsx` for small decorative icons.
  Its `.fm-icon-glass` material supplies the faint
  neutral edge, a subtle monochrome specular gradient, inset glint,
  `shadow-icon-glass`, and full foreground ink. The consumer supplies dimensions,
  alignment and radius: normally a 32–40px well with a 16px icon.
- Do not combine `.fm-icon-glass` with competing `bg-*`, `border-*`, faded ink,
  or custom shadow classes. The glyph stays crisp and opaque. Decorative wells
  do not replace accessible button names or the minimum control target.
  The same well is used in widget headers, the attention summary, recent
  activity rows, and empty-state icons so the material remains consistent.
- Glass is confined to these small icon backings. Reading surfaces, metric
  cells and controls remain opaque; no backdrop blur, translucent text, colored
  glow, oversized specular gradients or decorative glass panels.

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
Separator, Skeleton, ScrollArea, Command, Kbd, Segmented, PillProgress, IconWell,
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
- Motion: 150–200ms ease-out for controls. Static cards retain their base
  elevation on hover and never lift. Use a subtle surface change for an actual
  clickable item; any interactive elevation must use the shared shadow token.
  Existing page-entry motion respects `prefers-reduced-motion`. Nothing bouncy.
- Dark mode must be checked for every screen: cards keep a visible neutral edge
  and restrained inset highlight alongside their base elevation. Shadows alone
  must never define a boundary; images/plates already work in both.

## Layout

- Page content lives inside `app/(app)/*` under the shared horizontal shell.
  Keep the existing FortMark logo and Archivo identity. Core destinations stay
  in primary navigation; secondary destinations stay in More. New is the one
  primary creation action: white on the black header, with its label visible
  from `md` and a 44px plus control on phones. Search, notifications, settings,
  theme and account controls use quiet supporting treatments and remain available.
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
- Keep vertical rhythm deliberate: 16–20px between related content groups and
  20px standard card insets. Hero, snapshot and workspace headings should form
  a compact progression, not three separate cover sections. Preserve readable
  line spacing and touch targets while reducing empty vertical space.
- Bento/cards: `rounded-card` (16px); inner panels/popovers `rounded-panel`
  (12px); controls `rounded-lg` or `rounded-md` (8px); composer 16px. Light cards
  use a soft layered shadow and quiet edge; dark cards combine a neutral border,
  inner top highlight and soft base depth through the same elevation token.
- Shared cards and widgets use 20px insets. Widget headers use a compact 32px
  `.fm-icon-glass` backing, sentence-case title, optional 11px period caption, and named
  period/expand controls. Titles may wrap instead of disappearing into ellipses.
  Expanded widgets preserve the same content and keyboard-accessible dialog.
- Tables: 13px, `.text-micro` headers, paginate past ~10-12 rows with a
  quiet "Showing x–y of z" + Previous/Next buttons.

## Working screens

- Listings use framed source media, a clear price/address hierarchy, and a quiet
  specification footer. The card stays one Link, with no nested interactive controls.
- The listing gallery opens a full-viewport dialog with contained images, visible
  photo counts, thumbnails, 44px controls, arrow-key navigation, Escape, and focus
  return. Missing MLS photos remain neutral; never substitute a sample property.
- Transaction progress identifies the current workflow position. Earlier steps
  are not checked off and stage position is never a deal-completion percentage.
  Paused and exited files retain their actual status and remain available in Table.
- Detail drawers have a pinned header, scrolling details and pinned action footer.
  Keep the close control visible, preserve keyboard focus on return, and state when
  milestones or dates are absent. Query and action failures need visible feedback.
- Horizontal boards scroll inside the page. The main shell clips horizontal
  overflow without creating a second vertical scroll container; dialogs stay portaled.
- Contacts opens with the same section title treatment and a clear New contact
  action. The attention snapshot leads with overdue and due-today reminders;
  every count still applies exactly the filters it measures. Upcoming is a
  shortcut over stored reminders, with no invented count.
- The contact list gives the person's name and next follow-up a clear hierarchy.
  Desktop tables keep sorting and paging on the server; phones show the same
  records as readable single-action rows. Advanced filters expand on demand at
  every width, with applied-filter summaries visible while collapsed. Keep the
  desktop toolbar compact enough to reveal contacts early. Search text stays out
  of the URL.
- Contact drawers keep identity and the close control visible while details
  scroll. Notes, activity, client needs, and linked deals retain their own clear
  sections and honest missing-data states. Follow-up reminders and logged touches
  stay distinct: completing a reminder does not claim the contact was reached.
- Contact searches start at page one and keep typed names, emails and numbers out
  of the URL. Refresh on business-day rollover and returning to the tab. Upcoming
  reminders default to earliest first; sorting is available on phones.
- Contact details and birthday editors save against their opening revision.
  A newer saved version keeps the local draft and requires explicit review;
  no untouched field is written back from an old form.
- Structured Client Needs are authoritative once present. Only active needs
  determine list intent, budget and areas. Legacy opportunities are a fallback
  only when no structured needs exist. Every saved requirement has a readable
  view, including historical needs and read-only roles.
- Selecting Other for need type, property type or financing reveals a named
  description field. Keep the user's draft when they change the selection; save
  only the descriptions that still apply. Legacy Other records remain readable.
- About this client is optional reference information under Details: a short
  note and named label/value items. It has the same authorized read/write and
  frozen-revision review as contact editing. Keep these values out of list DTOs,
  search, existing AI tools and audit metadata; audit changed field names only.
- Contact stage is the relationship lifecycle. Transaction stage describes an
  individual deal. Stage menus show valid destinations, archived contacts use
  explicit Restore, and an old confirmation cannot overwrite a newer stage.
  A stage-only change does not count as a touch or move a linked deal.
- Notes, activity and needs load older records with scoped, stable cursors.
  Display loaded counts honestly; never label a partial page as a complete
  history. Completing the final page keeps keyboard focus on its control.
- Next action leads the contact file, before Details, in one quiet card with
  a glass icon well, purpose, exact Eastern due time, owner and state. Reuse
  the existing card shadow and input tokens. Complete, edit and cancel are
  explicit actions; completion requires an outcome and can schedule a successor
  in the same save. Task completion never implies a client interaction.
- Timed actions become overdue at their deadline; legacy reminders remain
  day-based. Home, contact filters, snapshot counts and list rows share this
  rule. Keep current content visible during clock refreshes. Preserve drafts
  across failed saves, assignee refreshes and explicit conflict review.
- Import contacts and Review duplicates are quiet secondary actions beside
  New contact, offered only to roles that can write. They open dedicated review
  dialogs; choosing a file or opening a suggestion never writes a contact.
- CSV import follows file or paste, column mapping, row checking and correction,
  explicit add/update/skip decisions, final review, then saved results. Keep the
  raw file local and send only mapped fields for checking. Respect the shared
  1 MiB, 250-row and 50-column limits. Corrections require a new row check before
  saving; lock editing while a check is pending so its response cannot erase a
  newer draft. Show validation errors and actual row counts without fake progress.
- Exact email/phone and in-file matches require an explicit separate-contact
  choice before Add. Similar-name hints are advisory and do not require that
  override. Updates name the saved target and its reviewed revision; blank
  imported fields leave saved values in place and imported notes become separate
  notes. Final review shows human source/stage labels and the actual field values;
  saved results report the server's added, updated and skipped outcomes.
- Same-name candidates must remain distinguishable in cards, update options,
  selected-target summaries and final review. Include phone, with email as a
  fallback, in update options; include company and human stage in the option
  label and selected-target summary where available. Never make the person choose
  between identical name-only options when identifying details exist.
- Duplicate Review is advisory and scoped to one owner's book. Choose the
  primary contact, explicitly choose conflicting field versions, and review
  retained-record counts. Primary and duplicate cards keep email, phone and
  company visible through final review so same-name records remain identifiable.
  After success the footer offers Close and Open primary contact, without
  returning to completed merge choices. Nonconflicting defaults may fill blanks. Structured
  next actions and date-only reminders both participate in the pending-schedule
  choice: retain a sole schedule by default; if both exist, require a choice.
  Choosing none explicitly clears pending schedules, with action history retained.
  Engagement acknowledgement follows the shared stage-transition rule; keeping
  the primary's existing Representation stage does not ask again.
- Merge retains notes, needs, activity and linked records. The duplicate remains
  an archived record pointing to the primary, and old links open the primary.
  Do not promise unmerge. Freeze both contact revisions and history fingerprints;
  a stale review keeps explicit choices but requires a deliberate review of fresh
  versions. Exact retries reuse their request identity for both import and merge.
- Import and duplicate dialogs fit 320px screens with wrapping values, a bounded
  height, pinned heading/actions and one scrolling body. Full comparison text
  stays readable without extra static-value tab stops or nested scroll regions.
  Moving to a new review step or recovering from a failed review resets that
  body to the top and focuses its heading; field choices preserve the scroll position.
  Import pagination announces its range and focuses the first new row. Duplicate
  scans report examined contacts and loaded suggestions honestly: an empty
  intermediate page still offers Continue checking, and completing the last page
  keeps its control present for focus. Retry returns to a stable review control;
  closing returns focus to the toolbar action that opened the dialog.

## Named property lists

- Contact files show a compact Property lists launcher with New list and View
  lists. No property cards, MLS lookup form or list hydration runs in the contact
  drawer. Both actions open the separate full-page workspace.
- The workspace defaults to the user's own named lists. A contact filter may
  narrow it. Cards show list name, count and optional contact, and remain
  openable when empty. New list asks for a readable name in a compact dialog;
  context decides whether it is personal or linked to the current contact.
- Opening a list shows a wide responsive property grid, clear list identity,
  back-to-lists navigation, Rename, Add property and Refresh from MLS. Use the
  established neutral cards, glass icon wells and restrained status pills.
- Add property is a bounded popup: MLS number → Find property → factual preview
  → Add to list. Freeze the reviewed list and MLS identity while saving. A
  confirmed save closes the popup and refreshes that list; uncertain saves keep
  the draft for a safe retry. No automatic matching or outgoing messages.
- Property cards preserve attribution, withheld addresses, truthful missing
  media and source/sample labels. Missing or disconnected MLS records retain
  their saved references. View listing and Remove from list are sibling
  controls; removal clearly names only the currently opened list.
- Gallery/detail pagination uses settled current-request answers and recovers
  after final-page removals. At 320px, grids become one column, dialog bodies
  scroll with visible actions, long names/identifiers wrap, and keyboard focus
  returns to a stable opener or the saved item. Read-only roles have no mutation
  controls; private-list existence is never disclosed through client scope.

## Property research

- Keep Your review visually separate from the MLS status. Use neutral labels
  for To review, Shortlisted and Ruled out, plus a two-line private note preview.
- Consolidate writer controls in a labelled Actions menu: Edit review, Copy or
  move, Remove from list. Read-only users can open the complete note in a quiet
  read view with no form or save action.
- Edit review is a bounded popup with a complete note field, character count
  and pinned actions. Freeze the opening revision; preserve a refused draft
  and compare the latest saved note/status before accepting its revision.
- Copy/move names the destination and states whether the source remains. Do
  not choose a destination automatically. Loaded options must be owner-scoped
  and distinguish personal/contact lists and duplicate names. A duplicate
  destination gives a non-destructive explanation and keeps the source.
- Filter and sort controls have explicit labels, reset pagination and accept
  only settled responses for that same view. Empty filtered results must not
  claim the whole list is empty. Price-sort failures retain the loaded view
  with retry or date-added recovery.
- On success, close the popup and focus a stable opener or workspace heading;
  the edited/moved card may no longer exist under the current filter. At 320px,
  note and transfer bodies scroll while save/copy/move actions stay visible.

## Copy checklist (every string you write)

sentence case · plain verbs · button = the action ("Add lead", "Save
changes") · no "!" · no emojis · no hype ("powerful", "amazing" forbidden) ·
errors: what + fix · empty states: direction. The tagline appears ONLY on
the login screen and README, exact: `Real estate, returned to its profession.`

# FortMark Dashboard

Real estate, returned to its profession.

The FortMark brokerage workspace: a production-quality Next.js UI running
against a typed mock data layer. Every data access point is an adapter, so
swapping mocks for real services is a one-file change per domain.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

## Architecture seams

### 1. Data adapters — `lib/data/adapters/`

One file per domain: `listings`, `transactions`, `leads`, `calendar`,
`documents`, `agents`, `market`, `messages`, `notifications`, `metrics`,
`search`, `settings`. Each exports async functions returning the shapes in
`lib/data/types.ts`. Components consume them only through the `useQuery` hook
(`lib/data/hooks.ts`) — never the mock store directly.

To go live on a domain, rewrite the bodies of that one adapter file (e.g.
point `getListings` at the MLS/RESO API or Supabase). The types, hooks, and
every component stay untouched. Mock mutations bump a version counter that
refetches all consumers — the same contract a server mutation + revalidation
will have.

Mock data lives in `lib/data/mock/` (seeded, deterministic, South Florida).
Listing "photos" are local SVG plates in `public/photos/`; the `photos` field
is a URL array, so real MLS media drops in via the adapter.

### 2. AI client — `lib/ai/client.ts` + `app/api/chat/route.ts`

The UI consumes `sendMessage(messages, opts): AsyncIterable<string>` and
knows nothing about the provider. The streaming route handler in
`app/api/chat/route.ts` currently streams a mock reply; the
`// TODO: connect provider` block is where the real model call goes
(map provider deltas onto the same plain-text stream). Swapping in the real
model is that one file.

Conversation history persists to `localStorage` (`fm.ai.threads.v1`) via
`lib/ai/store.ts` — threads, per-message feedback, and the active thread id.
Ids are counter-based (not random) so a server render and the first client
render never disagree; the counter resumes past whatever rehydrates.

`app/(app)/ai/page.tsx` owns the stream lifecycle: it appends an empty
assistant turn, grows it token by token, and aborts through an
`AbortController` when you press Stop. A stop before the first token removes
the empty turn rather than leaving it in the transcript.

### 3. Auth — `app/(auth)/` + `middleware.ts` + `lib/auth/session.ts`

Route groups are already split: `app/(auth)/login` and `app/(app)/...`.
`middleware.ts` passes everything through behind a `// TODO: session check`
marker; `lib/auth/session.ts` returns a mock session. When the provider
lands, implement the check in those two files and the login form's submit
handler — the routing structure doesn't change.

### 4. Suggestion chips — `lib/ai/suggestions.ts`

The chips under the AI composer render exclusively from the exported
`SUGGESTIONS` array. Edit labels, prompts, optional icons and descriptions in
that one place. A chip fills its `prompt` into the composer (label when the
prompt is empty) and focuses the caret — it never auto-sends.

## Design system

`docs/DESIGN-SYSTEM.md` is the operative contract (tokens, typography,
components, chart rules, copy rules); `docs/PLAN.md` holds the plan and its
critique. In short: strict monochrome from the four FortMark tokens, Archivo
only, status color confined to badge-sized pills, light and dark both
first-class, everything keyboard-navigable.

## Notes

- Dashboard widget order is drag-reorderable and persists to
  `localStorage` (`fm.dashboard.layout.v1`).
- The top-bar period selector (Today / Week / Month / Quarter / Year) drives
  every widget through `lib/stores/date-range.ts`.
- ⌘K opens global search across listings, transactions, and contacts.
- AI (`/ai`): thread sidebar, streaming transcript with markdown (tables,
  code, quotes), Stop mid-stream, copy and thumbs feedback per reply.
  Enter sends, Shift+Enter inserts a newline.
- Messages (`/messages`): two-pane inbox filtered by search, participant
  role, and unread. Opening a thread marks it read; replies go through
  `sendThreadMessage`, which bumps the data version and refetches both panes.

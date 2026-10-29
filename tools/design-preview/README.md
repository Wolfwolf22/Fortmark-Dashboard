# FortMark design preview

This isolated local harness renders the production `AppShell`, `TopBar`, Home
components, widgets and shared controls against synthetic, clearly labelled data.
It does not add a production route or bypass authentication. All fetch calls are
intercepted locally, all writes are rejected, and layout changes are memory-only.
The profile and creation dialogs are explicit preview-only placeholders.

Run from the repository using Node 22 or later:

```sh
node tools/design-preview/server.mjs
```

Open `http://127.0.0.1:4173/preview`. The server rebuilds the real component
bundle and Tailwind styles on page reload. Use the existing theme control for
light/dark, Settings for foundations, and browser width for responsive review.
No extra dependencies, accounts or environment secrets are required.

For deterministic phone/tablet/desktop review, open
`http://127.0.0.1:4173/responsive?width=390`. Its same-origin iframe gives the
real app a 320, 390, 768, 1280 or 1440 px viewport without relying on the
browser's viewport override capability.

The preview includes actual Listings index, listing-detail/gallery and
Transactions board/table/drawer components. Sample cases cover one/multiple/no
images, broken MLS media, offer/due diligence/financing/closing preparation,
on-hold and closed deals, and empty or mixed milestone states. Images are local
illustrative SVG plates, not property photographs. The broken-Media MLS case is
synthetic too, and exists solely to verify the neutral no-photo fallback.

The Home totals derive from the same synthetic transaction work list. No live
feed is connected, so the real featured-listing component keeps its honest
unavailable state. All mutations in the preview adapters reject without changing
the fixtures. This is a visual review, not a workflow certification.

Direct examples:

- `/preview?view=%2Flistings`
- `/preview?view=%2Flistings%2Fsample-coastal`
- `/preview?view=%2Ftransactions`
- `/preview?view=%2Ftransactions%3Fopen%3Dsample-financing`
- `/responsive?width=320&height=568&view=/listings/sample-coastal`

The responsive review offers width and height selectors and Return to top.
Transaction preview controls include a first-request-unavailable scenario;
the real page's Retry action then recovers the sample records.

## Contacts and follow-ups

Contacts now renders the actual list, filters, paging and contact drawer.
Thirty synthetic contacts exercise two pages and include due-today, overdue,
upcoming, never-touched, past-client, colleague-owned and labeled sample-fallback
cases. The preview reuses the production pure query evaluator for filters, sorts,
snapshot counts and pagination. Changing filters preserves preview scenarios
within the same section.

Most fixtures intentionally have the stored-record DTO shape (`recordSource:
"db"`) so the real birthday, needs, notes, activity and linked-transaction UI
can be inspected. This does not connect a database or alter production gates:
every name is prefixed Sample, the persistent preview banner says read-only
sample data, and every mutation rejects. `sample-labeled-fallback` retains the
actual sample-source unavailable sections for comparison.

Useful contact routes:

- `/preview?view=%2Fcontacts`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-overdue`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-due-today`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-upcoming`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-quiet`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-labeled-fallback`
- `/preview?view=%2Fcontacts%3Fopen%3Dsample-contact-23` (long name and email)
- `/responsive?width=320&height=568&view=/contacts?open=sample-overdue`

Contacts has Records, Empty contact book and First request unavailable preview
scenarios. The unavailable scenario fails the first list request; the actual
Retry control recovers the fixture list. Home contact totals and its attention
queue derive from these same sample contacts and transaction milestones.

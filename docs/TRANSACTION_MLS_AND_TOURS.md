# MLS property and showing-tour connections

Local implementation, 2026-11-02. Migration 0028 remains unapplied live.

## Exact MLS linking and property display

The transaction file has a property panel above the workflow checklist. Enter an
exact MLS number, review the returned listing/photo/address/asking price, choose
whether to copy the address and entered list price, then link the property.
The stored reference includes dataset, ListingKey and MLS number. Legacy manual
MLS text does not become a verified link without this lookup and review.

The server resolves and validates the exact property again before saving. A
fingerprint binds the reviewed identity, importable address and asking price;
a changed MLS result requires another review. Withheld, missing or invalid
addresses cannot be imported, and an unknown asking price cannot become $0.
No MLS payload, photo URLs, tax data or fee snapshot is persisted in the deal.
Only the selected reference and explicitly imported file fields are stored.

Current MLS asking price, status, property facts, photos and available financial
fields are read fresh while the file is open. Reads refresh on visible mount,
return/focus, every five visible minutes and the Refresh from MLS action.
Refreshing is read-only. The entered contract price, entered list price, dates,
commissions, checklist, lender figures and private notes are not overwritten.
The MLS price remains separate from negotiated contract terms and Home volume.
The gallery supports all returned photos with an honest empty/broken-media state.

The verified global MLS projection remains unchanged. A separate bounded exact
Property read omits `$select`, so it only returns fields that this dataset
actually publishes. Only normalized permitted display data leaves the provider.
Annual tax amount, tax year, association fee and fee frequency appear when
present and valid. The monthly tax equivalent is the reported annual amount
split by twelve, with the tax year shown; it is not a forecast of a future bill.
It does not fill or replace a lender's monthly figures. Missing fields remain
unprovided. A financial enrichment failure does not discard an otherwise
available listing. Listing-office attribution and display/withheld controls
are preserved. Provider failures never become synthetic live data.

Unlinking clears the verified property reference and live display while keeping
entered addresses, prices and transaction work. Editing a verified MLS identity
through the general details form is refused; use the reviewed property flow.

## Explicit private tour links

Showing tours can be linked explicitly to a transaction and opened from it.
The tour shows a reciprocal Related transactions section. Links require a real
shared client contact in the transaction parties and current authorization for
both records. Display names or matching MLS numbers alone do not create links.
A file with name-only parties has no eligible tour until a genuine contact
relationship exists; creating a deal from its client contact establishes that
existing relationship without promoting the client's stage automatically.

Each linked tour shows whether its current saved property references match the
transaction's verified MLS identity, are other properties for this client, or
cannot currently be checked. A changed MLS property does not erase the tour
relationship. Changing a tour's client cannot silently repoint linked deals to
a different client. Contact merges keep the existing party and tour references
consistent through their normal merge flow.

Tours and property lists remain owner-private, including for Admin users with
wider transaction access. Forward and reverse reads intersect both scopes and
recheck them after dependent reads; hidden names, IDs and counts are not shown.
Results are bounded at 100 linked and 100 candidate tours with truncation flags.
Linking requires an active editable file and an unarchived own tour. Unlinking
an archived own tour is allowed on an editable transaction. Neither operation
changes appointments, schedules a showing or calls a route provider.

## Consistency and release

Address imports update the transaction's existing record, so the worklist,
linked contact deals and Home references read the same saved identity. MLS-number
search works in the worklist; the existing global search uses the stored number.
Live property reads use the existing authenticated MLS connection. All new
mutations require a parent revision and immutable request ID; tour associations
also compare and advance the tour revision. Exact retries recover a committed
result without a second import/link or another provider lookup. Scope and current
account role/status are rechecked within atomic writes. Safe history records
actions and changed field names, without financial values or private notes.

The local preview uses synthetic properties, taxes, images and tour data. No live
MLS, database, storage or routing provider was called during this implementation.
Migration, live MLS entitlement checks, signed-in certification and deployment
remain release steps. Existing private-file storage setup remains separate.

Final verification: 8,804/8,804 numbered checks plus the unnumbered
workspace suite passed. All 195 isolated preview groups passed. Desktop and
320px phone checks confirmed exact lookup/review/import, tax and fee display,
photo navigation, reciprocal tour links, and no horizontal overflow.

import "server-only";

/** Duplicate review is deliberately stricter than admin contact visibility: own book only. */
import { createHash } from "node:crypto";
import { and, asc, ne, notInArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Actor } from "../auth/actor.ts";
import { contacts } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { canCreateFor } from "./domain.ts";
import type { Ctx, ServiceResult } from "./service.ts";
import {
  DUPLICATE_PAGE_SIZE, MAX_DUPLICATE_PAGE_SIZE, DUPLICATE_SCAN_CONTACTS, COMPLETED_DUPLICATE_ANCHOR, decodeDuplicateCursor, encodeDuplicateCursor,
  duplicateNameKey, duplicateReasons, normalizeDuplicateEmail, normalizeDuplicatePhone,
  toDuplicateContact, type DuplicateIdentity, type DuplicateMatch, type DuplicateRecord,
  type DuplicateSuggestionsPage, type ExactDuplicateMatch,
} from "./duplicates.ts";

type DuplicateTable = { [K in "id" | "brokerageKey" | "assignedAgentUserId" | "mergedIntoContactId" | "deletedAt" | "email" | "phoneE164" | "firstName" | "lastName" | "preferredName"]: SQLWrapper };

/** Shared with the import's atomic commit guard. Never substitute admin visibility. */
export function ownDuplicateBookPredicate(actor: Actor, table: DuplicateTable = contacts, options: { includeMerged?: boolean } = {}): SQL {
  return sql`${table.brokerageKey} = ${actor.brokerageKey} and ${table.assignedAgentUserId} = ${actor.userId}::uuid and ${table.deletedAt} is null ${options.includeMerged ? sql`` : sql`and ${table.mergedIntoContactId} is null`}`;
}

function emailKey(column: SQLWrapper): SQL {
  const value = sql`btrim(${column})`;
  return sql`case when char_length(${value}) <= 320 and ${value} !~ '[[:cntrl:]]' and ${value} ~ '^[^[:space:]@<>()\\[\\]\\\\,;:"]+@[^[:space:]@<>()\\[\\]\\\\,;:"]+\\.[^[:space:]@<>()\\[\\]\\\\,;:"]+$' then lower(${value}) else null end`;
}
function phoneKey(column: SQLWrapper): SQL {
  const compact = sql`regexp_replace(btrim(${column}), '[[:space:]()-]', '', 'g')`;
  const digits = sql`regexp_replace(${column}, '[^0-9]', '', 'g')`;
  return sql`case when char_length(${column}) <= 40 then case
    when ${compact} ~ '^\\+[1-9][0-9]{7,14}$' then ${compact}
    when char_length(${digits}) = 10 then '+1' || ${digits}
    when char_length(${digits}) = 11 and left(${digits}, 1) = '1' then '+' || ${digits}
    else null end else null end`;
}

/** Exact identity only; callers must also apply ownDuplicateBookPredicate. */
export function exactDuplicatePredicate(input: DuplicateIdentity, table: DuplicateTable = contacts): SQL | undefined {
  const email = normalizeDuplicateEmail(input.email), phone = normalizeDuplicatePhone(input.phoneE164 ?? input.phone);
  if (email && phone) return sql`(${emailKey(table.email)} = ${email} or ${phoneKey(table.phoneE164)} = ${phone})`;
  if (email) return sql`${emailKey(table.email)} = ${email}`;
  if (phone) return sql`${phoneKey(table.phoneE164)} = ${phone}`;
  return undefined;
}

/** PostgreSQL's Unicode normalization mirrors the pure name key, without extensions. */
function nameKey(table: Pick<DuplicateTable, "firstName" | "lastName" | "preferredName">): SQL {
  const full = sql`case when btrim(coalesce(${table.firstName}, '')) <> '' and btrim(coalesce(${table.lastName}, '')) <> ''
    then concat_ws(' ', ${table.firstName}, ${table.lastName})
    else coalesce(nullif(btrim(${table.preferredName}), ''), concat_ws(' ', ${table.firstName}, ${table.lastName})) end`;
  return sql`btrim(regexp_replace(regexp_replace(lower(normalize(${full}, NFKD)), '[̀-ͯ]', '', 'g'), '[^[:alnum:]]+', ' ', 'g'))`;
}
function similarNameKeys(left: SQLWrapper, right: SQLWrapper): SQL {
  const firstA = sql`split_part(${left}, ' ', 1)`, firstB = sql`split_part(${right}, ' ', 1)`;
  const lastA = sql`split_part(${left}, ' ', -1)`, lastB = sql`split_part(${right}, ' ', -1)`;
  return sql`(strpos(${left}, ' ') > 0 and strpos(${right}, ' ') > 0 and ${left} !~ '[[:digit:]]' and ${right} !~ '[[:digit:]]' and (
    ${left} = ${right} or (
      char_length(${firstA}) >= 3 and char_length(${firstB}) >= 3 and char_length(${lastA}) >= 3 and char_length(${lastB}) >= 3 and (
        (${lastA} = ${lastB} and left(${firstA}, 3) = left(${firstB}, 3)) or (${firstA} = ${firstB} and left(${lastA}, 3) = left(${lastB}, 3))
      )
    )
  ))`;
}
export function similarDuplicateNamePredicate(input: DuplicateIdentity, table: DuplicateTable = contacts): SQL | undefined {
  const key = duplicateNameKey(input);
  return key ? similarNameKeys(sql`${key}`, nameKey(table)) : undefined;
}

const candidateFields = {
  id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, preferredName: contacts.preferredName,
  email: contacts.email, phoneE164: contacts.phoneE164, company: contacts.company, stage: contacts.stage, updatedAt: contacts.updatedAt,
};
export interface ExactDuplicateSource { id: string; updatedAt: string; canonicalId: string; reasons: ("exact_email" | "exact_phone")[] }
export interface ExactContactDuplicates { matches: ExactDuplicateMatch[]; sources: ExactDuplicateSource[]; fingerprint: string; count: number }

/** Complete exact set: no LIMIT, partial count, fuzzy blocker or auto-merge. */
export async function findExactContactDuplicates(ctx: Ctx, input: DuplicateIdentity, options: { excludeContactId?: string } = {}): Promise<ServiceResult<ExactContactDuplicates>> {
  if (!canCreateFor(ctx.actor, ctx.actor.userId)) return { ok: false, reason: "forbidden" };
  if (options.excludeContactId && !isRecordId(options.excludeContactId)) return { ok: false, reason: "invalid_request" };
  const predicate = exactDuplicatePredicate(input);
  const canonical = alias(contacts, "duplicate_canonical");
  const rows = predicate ? await ctx.db.select({
    source: { id: contacts.id, updatedAt: contacts.updatedAt, email: contacts.email, phoneE164: contacts.phoneE164 },
    canonical: { id: canonical.id, firstName: canonical.firstName, lastName: canonical.lastName, preferredName: canonical.preferredName,
      email: canonical.email, phoneE164: canonical.phoneE164, company: canonical.company, stage: canonical.stage, updatedAt: canonical.updatedAt },
  }).from(contacts).innerJoin(canonical, sql`${canonical.id} = coalesce(${contacts.mergedIntoContactId}, ${contacts.id})`)
    .where(and(ownDuplicateBookPredicate(ctx.actor, contacts, { includeMerged: true }), ownDuplicateBookPredicate(ctx.actor, canonical), predicate,
      options.excludeContactId ? ne(canonical.id, options.excludeContactId) : undefined))
    .orderBy(asc(contacts.id)) : [];
  const grouped = new Map<string, ExactDuplicateMatch>();
  const sources: ExactDuplicateSource[] = [];
  for (const row of rows) {
    const reasons = duplicateReasons(input, row.source).filter(reason => reason !== "similar_name");
    if (!reasons.length) continue;
    sources.push({ id: row.source.id, updatedAt: row.source.updatedAt.toISOString(), canonicalId: row.canonical.id, reasons });
    const prior = grouped.get(row.canonical.id);
    const combined = new Set([...(prior?.reasons ?? []), ...reasons]);
    grouped.set(row.canonical.id, { contact: toDuplicateContact(row.canonical), reasons: (["exact_email", "exact_phone"] as const).filter(reason => combined.has(reason)) });
  }
  const matches = [...grouped.values()].sort((a, b) => a.contact.id < b.contact.id ? -1 : a.contact.id === b.contact.id ? 0 : 1);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    sources: sources.map(source => [source.id, source.updatedAt, source.canonicalId, source.reasons]),
    matches: matches.map(match => [match.contact.id, match.contact.updatedAt, match.reasons]),
  })).digest("hex");
  return { ok: true, value: { matches, sources, fingerprint, count: matches.length } };
}

/** Import name hints stay bounded and advisory; the fingerprint/count cover exact matches only. */
export async function findImportContactDuplicates(ctx: Ctx, input: DuplicateIdentity, options: { excludeContactId?: string } = {}): Promise<ServiceResult<Omit<ExactContactDuplicates, "matches"> & { matches: DuplicateMatch[]; advisoryHasMore: boolean }>> {
  const exact = await findExactContactDuplicates(ctx, input, options);
  if (!exact.ok) return exact;
  const predicate = similarDuplicateNamePredicate(input);
  const rows = predicate ? await ctx.db.select(candidateFields).from(contacts).where(and(
    ownDuplicateBookPredicate(ctx.actor), predicate, options.excludeContactId ? ne(contacts.id, options.excludeContactId) : undefined,
    exact.value.matches.length ? notInArray(contacts.id, exact.value.matches.map(match => match.contact.id)) : undefined,
  )).orderBy(asc(contacts.id)).limit(11) : [];
  const advisory = rows.map(row => ({ contact: toDuplicateContact(row), reasons: ["similar_name"] as const }));
  return { ok: true, value: { ...exact.value, matches: [...exact.value.matches, ...advisory.slice(0, 10).map(match => ({ ...match, reasons: [...match.reasons] }))], advisoryHasMore: advisory.length > 10 } };
}

type PairRow = { primary: DuplicateRecord; duplicate: DuplicateRecord; reasons: ("email" | "phone" | "similar_name")[] };

/** One SQL snapshot yields bounded pairs and truthful whole-book/fully-scanned counts. */
export async function getContactDuplicateSuggestions(ctx: Ctx, options: { cursor?: string; pageSize?: number } = {}): Promise<ServiceResult<DuplicateSuggestionsPage>> {
  if (!canCreateFor(ctx.actor, ctx.actor.userId)) return { ok: false, reason: "forbidden" };
  const pageSize = options.pageSize ?? DUPLICATE_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_DUPLICATE_PAGE_SIZE) return { ok: false, reason: "invalid_request" };
  const cursor = options.cursor ? decodeDuplicateCursor(options.cursor) : undefined;
  if (options.cursor !== undefined && !cursor) return { ok: false, reason: "invalid_request" };
  const boundary = cursor ? sql`and (a.id > ${cursor.primaryId}::uuid or (a.id = ${cursor.primaryId}::uuid and b.id > ${cursor.duplicateId}::uuid))` : sql``;
  const anchorBoundary = cursor ? (cursor.duplicateId === COMPLETED_DUPLICATE_ANCHOR ? sql`where id > ${cursor.primaryId}::uuid` : sql`where id >= ${cursor.primaryId}::uuid`) : sql``;
  const emailMatch = sql`a.email_key is not null and a.email_key <> '' and a.email_key = b.email_key`;
  const phoneMatch = sql`a.phone_key is not null and a.phone_key = b.phone_key`;
  const nameMatch = similarNameKeys(sql`a.name_key`, sql`b.name_key`);
  const fields = (alias: "a" | "b") => sql.raw(`jsonb_build_object('id', ${alias}.id, 'firstName', ${alias}.first_name, 'lastName', ${alias}.last_name, 'preferredName', ${alias}.preferred_name, 'email', ${alias}.email, 'phoneE164', ${alias}.phone_e164, 'company', ${alias}.company, 'stage', ${alias}.stage, 'updatedAt', ${alias}.updated_at)`);
  const result = await ctx.db.execute<{ pairs: PairRow[]; total_contacts: number; scanned_contacts: number; completed_scanned: number; has_unscanned: boolean; last_anchor: string | null }>(sql`
    with eligible as materialized (
      select id, first_name, last_name, preferred_name, email, phone_e164, company, stage, updated_at,
        ${emailKey(contacts.email)} as email_key, ${phoneKey(contacts.phoneE164)} as phone_key, ${nameKey(contacts)} as name_key
      from ${contacts} where ${ownDuplicateBookPredicate(ctx.actor)}
    ), anchors as materialized (
      select * from eligible ${anchorBoundary} order by id limit ${DUPLICATE_SCAN_CONTACTS}
    ), matched as (
      select a.id as primary_id, b.id as duplicate_id, ${fields("a")} as primary_contact, ${fields("b")} as duplicate_contact,
        array_remove(array[case when ${emailMatch} then 'email' end, case when ${phoneMatch} then 'phone' end, case when ${nameMatch} then 'similar_name' end], null) as reasons
      from anchors a join eligible b on a.id < b.id
      where (${emailMatch} or ${phoneMatch} or ${nameMatch}) ${boundary}
      order by a.id, b.id limit ${pageSize + 1}
    )
    select coalesce(jsonb_agg(jsonb_build_object('primary', primary_contact, 'duplicate', duplicate_contact, 'reasons', reasons) order by primary_id, duplicate_id), '[]'::jsonb) as pairs,
      (select count(*)::int from eligible) as total_contacts,
      (select count(*)::int from eligible where id < (select primary_id from matched order by primary_id, duplicate_id offset ${pageSize - 1} limit 1)) as scanned_contacts,
      (select count(*)::int from eligible where id <= (select id from anchors order by id desc limit 1)) as completed_scanned,
      exists(select 1 from eligible where id > (select id from anchors order by id desc limit 1)) as has_unscanned,
      (select id from anchors order by id desc limit 1) as last_anchor
    from matched
  `);
  const row = result.rows[0];
  const pairs = (row?.pairs ?? []).slice(0, pageSize).map(pair => ({ primary: toDuplicateContact(pair.primary), duplicate: toDuplicateContact(pair.duplicate), reasons: pair.reasons }));
  const overflow = (row?.pairs.length ?? 0) > pageSize;
  const hasMore = overflow || Boolean(row?.has_unscanned);
  const last = pairs[pairs.length - 1];
  return { ok: true, value: {
    pairs, totalContacts: row?.total_contacts ?? 0,
    scannedContacts: overflow ? row.scanned_contacts : row?.last_anchor ? row.completed_scanned : row?.total_contacts ?? 0,
    hasMore, nextCursor: overflow && last ? encodeDuplicateCursor({ primaryId: last.primary.id, duplicateId: last.duplicate.id })
      : row?.has_unscanned && row.last_anchor ? encodeDuplicateCursor({ primaryId: row.last_anchor, duplicateId: COMPLETED_DUPLICATE_ANCHOR }) : null,
  } };
}

export const listContactDuplicateSuggestions = getContactDuplicateSuggestions;

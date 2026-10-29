"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { PageIntro } from "@/components/common/page-intro";
import { useSessionUser } from "@/components/layout/session-user";
import { leadAbilities } from "@/components/leads/lead-shared";
import { contactPropertyFailure, SavedContactProperty } from "@/components/leads/contact-properties";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconWell } from "@/components/ui/icon-well";
import { Skeleton } from "@/components/ui/skeleton";
import { getLead, getLeadSource, getPropertyList, getPropertyListProperties, getPropertyLists, removePropertyListProperty } from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import type { PropertyListView } from "@/lib/contacts/property-lists";
import type { PropertyView } from "@/lib/contacts/properties";
import { AddPropertyDialog } from "./add-property-dialog";
import { ListNameDialog } from "./list-name-dialog";
import { propertyListFailure, propertyListsHref, propertyWorkspacePageRecovery } from "./review";

export function NamedPropertyListCard({ list, href }: { list: PropertyListView; href: string }) {
  return <Link href={href} className="group block h-full rounded-card"><Card className="flex h-full min-w-0 flex-col p-5 transition-shadow duration-150 group-hover:shadow-card-hover"><div className="flex items-start justify-between gap-3"><IconWell icon={FolderOpen} className="h-10 w-10 rounded-panel" /><ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></div><h3 className="mt-5 break-words text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{list.name}</h3><p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{list.contactId ? list.contactName ? `For ${list.contactName}` : "Linked to a contact" : "Personal research"}</p><p className="mt-auto border-t border-border pt-4 text-[13px] font-medium tabular"><span className="mt-4 inline-block">{list.propertyCount} {list.propertyCount === 1 ? "property" : "properties"}</span></p></Card></Link>;
}

export function PropertyListsWorkspace() {
  const params = useSearchParams(), router = useRouter();
  const contactId = params.get("contactId") || undefined, selectedId = params.get("list") || undefined;
  const rawPage = params.get("page") ?? "1", indexPage = /^\d{1,7}$/.test(rawPage) ? Math.max(1, Number(rawPage)) : 1;
  const createRequested = params.get("new") === "1";
  const roleCanWrite = leadAbilities(useSessionUser().role).canWrite;
  const source = useQuery(() => getLeadSource(), []);
  const canWrite = roleCanWrite && source.data === "db";
  const contact = useQuery(() => contactId ? getLead(contactId) : Promise.resolve(undefined), [contactId]);
  const contextReady = !contactId || Boolean(contact.data?.id === contactId);
  useEffect(() => {
    if (contactId && contact.data && contact.data.id !== contactId && contact.data.requestedContactId === contactId) router.replace(propertyListsHref({ contactId: contact.data.id, listId: selectedId, page: indexPage, newList: createRequested }), { scroll: false });
  }, [contactId, contact.data, router, selectedId, indexPage, createRequested]);
  function closeCreate(next: boolean) {
    if (!next) router.replace(propertyListsHref({ contactId, listId: selectedId, page: indexPage }), { scroll: false });
  }
  const indexHref = propertyListsHref({ contactId, page: indexPage });
  return <div className="space-y-4">
    {selectedId ? <PropertyListDetail key={selectedId} id={selectedId} canWrite={canWrite} indexHref={indexHref} onSourceRetry={source.refetch} /> : <PropertyListIndex key={contactId ?? "personal"} contactId={contactId} contactName={contact.data?.name} page={indexPage} canWrite={canWrite} onSourceRetry={source.refetch} onPage={(page) => router.push(propertyListsHref({ contactId, page }), { scroll: false })} />}
    {createRequested && contactId && !contextReady && <div role={contact.error || !contact.loading ? "alert" : "status"} className="space-y-3 rounded-panel border border-border bg-card p-4 text-sm"><p>{contact.error || !contact.loading ? "The contact could not be loaded. Retry, or return to all lists to create a personal research list." : "Loading the contact for this list…"}</p><div className="flex flex-wrap gap-2">{!contact.loading && <Button type="button" size="sm" variant="outline" onClick={contact.refetch}>Retry contact</Button>}<Button asChild size="sm" variant="ghost"><Link href="/property-lists">All property lists</Link></Button></div></div>}
    {createRequested && !roleCanWrite && <p role="note" className="text-sm text-muted-foreground">You have read-only access to property lists.</p>}
    {createRequested && roleCanWrite && source.data !== "db" && <div role={source.loading ? "status" : "alert"} className="space-y-2 text-sm text-muted-foreground"><p>{source.loading ? "Checking the property-list connection…" : propertyListFailure(source.error ?? { code: "sample_read_only" }, "read")}</p>{source.error && <Button type="button" size="sm" variant="outline" onClick={source.refetch}>Retry connection</Button>}</div>}
    {canWrite && contextReady && <ListNameDialog open={createRequested} onOpenChange={closeCreate} contact={contactId && contact.data ? { id: contact.data.id, name: contact.data.name } : undefined} onSaved={(list) => router.replace(propertyListsHref({ contactId, listId: list.id, page: indexPage }), { scroll: true })} />}
  </div>;
}

function PropertyListIndex({ contactId, contactName, page, canWrite, onPage, onSourceRetry }: { contactId?: string; contactName?: string; page: number; canWrite: boolean; onPage: (page: number) => void; onSourceRetry: () => void }) {
  const lists = useQuery(async () => ({ requestPage: page, result: await getPropertyLists({ contactId, page }) }), [contactId, page]);
  const data = lists.data?.result, current = lists.data?.requestPage === page && data?.page === page ? data : null;
  const recover = propertyWorkspacePageRecovery(page, lists.data, !lists.loading && !lists.error);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (recover !== null) onPage(recover); }, [recover, onPage]);
  const [focusPage, setFocusPage] = useState<number | null>(null);
  useEffect(() => { if (focusPage === page && !lists.loading && current) { heading.current?.focus(); setFocusPage(null); } }, [focusPage, page, lists.loading, current]);
  function navigate(page: number) { setFocusPage(page); onPage(page); }
  function refresh() { onSourceRetry(); lists.refetch(); }
  const last = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize || 12)));
  return <>
    {contactId && <div className="flex flex-wrap items-center justify-between gap-3"><Button asChild size="sm" variant="ghost" className="-ml-2"><Link href={`/contacts?${new URLSearchParams({ open: contactId })}`}><ArrowLeft aria-hidden="true" />Back to contact</Link></Button><Link href="/property-lists" className="min-h-10 rounded-md px-2 py-2 text-xs font-semibold underline underline-offset-4">All my lists</Link></div>}
    <PageIntro icon={FolderOpen} title="Property lists" description={contactId ? `Your private lists for ${contactName || "this contact"}.` : "Named lists for personal research and client work."} action={canWrite ? <Button asChild className="min-h-11"><Link href={propertyListsHref({ contactId, page, newList: true })}><Plus aria-hidden="true" />New list</Link></Button> : undefined} />
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 ref={heading} tabIndex={-1} className="text-sm font-semibold">{data ? `${data.total} ${data.total === 1 ? "list" : "lists"}` : "Your lists"}</h3><Button type="button" size="sm" variant="outline" disabled={lists.loading} onClick={refresh}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Refresh lists</Button></div>
    {!data && lists.loading ? <ListGridSkeleton /> : lists.error && !current ? <ListFailure error={lists.error} retry={refresh} /> : current?.total === 0 ? <Card className="p-6"><IconWell icon={FolderOpen} className="h-10 w-10 rounded-panel" /><h3 className="mt-4 text-base font-semibold">No property lists yet</h3><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{canWrite ? "Create a named list, then add properties by MLS number in its workspace." : "Your property lists will appear here when they are available."}</p>{canWrite && <Button asChild className="mt-4"><Link href={propertyListsHref({ contactId, page, newList: true })}>Create a list</Link></Button>}</Card> : current ? <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{current.items.map((list) => <NamedPropertyListCard key={list.id} list={list} href={propertyListsHref({ contactId, listId: list.id, page })} />)}</div> : <ListGridSkeleton />}
    {lists.error && current && <ListFailure error={lists.error} retry={refresh} retained />}
    {data && data.total > data.pageSize && <PageControls page={Math.min(page, last)} last={last} total={data.total} noun="lists" busy={lists.loading} onPage={navigate} />}
  </>;
}

function PropertyListDetail({ id, canWrite, indexHref, onSourceRetry }: { id: string; canWrite: boolean; indexHref: string; onSourceRetry: () => void }) {
  const prefix = useId(), heading = useRef<HTMLHeadingElement>(null);
  const list = useQuery(() => getPropertyList(id), [id]);
  const [page, setPage] = useState(1), [addOpen, setAddOpen] = useState(false), [renameOpen, setRenameOpen] = useState(false);
  const properties = useQuery(async () => ({ requestPage: page, result: await getPropertyListProperties(id, page) }), [id, page]);
  const data = properties.data?.result, current = properties.data?.requestPage === page && data?.page === page ? data : null;
  const recover = propertyWorkspacePageRecovery(page, properties.data, !properties.loading && !properties.error);
  const [removing, setRemoving] = useState<string | null>(null), [confirm, setConfirm] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [focusTarget, setFocusTarget] = useState<string | null>(null);
  useEffect(() => { if (recover !== null) setPage(recover); }, [recover]);
  useEffect(() => { if (focusTarget) { if (focusTarget === "heading") heading.current?.focus(); else document.getElementById(focusTarget)?.focus(); setFocusTarget(null); } }, [focusTarget, confirm]);
  async function remove(property: PropertyView) {
    if (removing || !canWrite) return;
    setRemoving(property.id); setFailure(null); setNotice(null);
    try { const result = await removePropertyListProperty(id, property.id); if (!result.removed) throw Error("Removal not confirmed"); setConfirm(null); setNotice(`MLS ${property.mlsNumber} removed from this list.`); properties.refetch(); list.refetch(); setFocusTarget("heading"); }
    catch (error) { setFailure(contactPropertyFailure(error, "remove")); properties.refetch(); }
    finally { setRemoving(null); }
  }
  function refresh() { onSourceRetry(); list.refetch(); properties.refetch(); }
  if (!list.data) return <><Button asChild size="sm" variant="ghost"><Link href={indexHref}><ArrowLeft aria-hidden="true" />Back to lists</Link></Button>{list.error ? <ListFailure error={list.error} retry={refresh} /> : <ListGridSkeleton />}</>;
  const model = list.data, last = Math.max(1, Math.ceil((data?.total ?? model.propertyCount) / (data?.pageSize || 12)));
  return <>
    <Button asChild size="sm" variant="ghost" className="-ml-2"><Link href={indexHref}><ArrowLeft aria-hidden="true" />Back to lists</Link></Button>
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5"><div className="flex min-w-0 flex-1 basis-full items-start gap-3.5 sm:basis-0"><IconWell icon={FolderOpen} className="h-10 w-10 rounded-panel" /><div className="min-w-0"><h2 ref={heading} tabIndex={-1} className="break-words text-[26px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-[30px]">{model.name}</h2><p className="mt-2 break-words text-[13px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{model.contactId ? model.contactName ? `For ${model.contactName}` : "Linked to a contact" : "Personal research"} · Private to you</p><p className="mt-1 text-xs text-muted-foreground tabular">{data?.total ?? model.propertyCount} {(data?.total ?? model.propertyCount) === 1 ? "property" : "properties"}</p></div></div><div className="flex flex-wrap gap-2">{canWrite && <><Button type="button" variant="outline" onClick={() => setRenameOpen(true)}>Rename</Button><Button type="button" onClick={() => setAddOpen(true)}><Plus aria-hidden="true" />Add property</Button></>}<Button type="button" variant="outline" disabled={properties.loading || Boolean(removing)} onClick={refresh}><RefreshCw className="h-4 w-4" aria-hidden="true" />{properties.loading && data ? "Refreshing…" : "Refresh from MLS"}</Button></div></div>
    {notice && <p role="status" className="rounded-panel border border-border bg-card p-3 text-sm">{notice}</p>}{failure && <p role="alert" className="text-sm leading-relaxed text-destructive">{failure}</p>}
    {!data && properties.loading ? <ListGridSkeleton /> : properties.error && !current ? <div role="alert" className="rounded-panel border border-border bg-card p-4"><p className="text-sm leading-relaxed">{contactPropertyFailure(properties.error, "read")}</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={properties.refetch}>Try again</Button></div> : current?.total === 0 ? <Card className="p-6"><IconWell icon={FolderOpen} className="h-10 w-10 rounded-panel" /><h3 className="mt-4 text-base font-semibold">This list is empty</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{canWrite ? "Add a property by its exact MLS number. Review the property before saving it here." : "No properties have been saved in this list."}</p>{canWrite && <Button type="button" className="mt-4" onClick={() => setAddOpen(true)}>Add the first property</Button>}</Card> : current ? <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{current.items.map((property) => <SavedContactProperty key={property.id} property={property} canWrite={canWrite} confirming={confirm === property.id} saving={Boolean(removing)} prefix={prefix} onAskRemove={() => { setConfirm(property.id); setFocusTarget(`${prefix}-property-${property.id}-confirm-remove`); }} onCancelRemove={() => { setConfirm(null); setFocusTarget(`${prefix}-property-${property.id}-remove`); }} onRemove={() => void remove(property)} />)}</div> : <ListGridSkeleton />}
    {properties.error && current && <p role="alert" className="text-xs leading-relaxed text-muted-foreground">Saved entries are kept. The latest MLS refresh failed. <button type="button" className="min-h-10 rounded-md px-1 font-semibold underline underline-offset-4" onClick={properties.refetch}>Try again</button></p>}
    {list.error && <ListFailure error={list.error} retry={refresh} retained />}
    {data && data.total > data.pageSize && <PageControls page={Math.min(page, last)} last={last} total={data.total} noun="properties" busy={properties.loading || Boolean(removing)} onPage={(next) => { setPage(next); setFocusTarget("heading"); }} />}
    {canWrite && <><AddPropertyDialog open={addOpen} onOpenChange={setAddOpen} listId={id} listName={model.name} onAdded={() => { setPage(1); properties.refetch(); list.refetch(); setNotice("Property saved to this list."); }} /><ListNameDialog open={renameOpen} onOpenChange={setRenameOpen} list={model} onSaved={() => { list.refetch(); setNotice("List name saved."); }} /></>}
  </>;
}

function ListGridSkeleton() { return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading property lists">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-52 w-full rounded-card" />)}</div>; }
function ListFailure({ error, retry, retained = false }: { error: unknown; retry: () => void; retained?: boolean }) { return <div role="alert" className="rounded-panel border border-border bg-card p-4"><p className="text-sm leading-relaxed">{propertyListFailure(error, "read")}{retained ? " Your loaded information is kept." : ""}</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={retry}>Try again</Button><Button asChild size="sm" variant="ghost"><Link href="/property-lists">All my lists</Link></Button></div></div>; }
function PageControls({ page, last, total, noun, busy, onPage }: { page: number; last: number; total: number; noun: string; busy: boolean; onPage: (page: number) => void }) { return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p role="status" className="text-xs text-muted-foreground tabular">Page {page} of {last} · {total} {noun}</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><Button type="button" size="sm" variant="outline" disabled={busy || page >= last} onClick={() => onPage(page + 1)}>Next</Button></div></div>; }

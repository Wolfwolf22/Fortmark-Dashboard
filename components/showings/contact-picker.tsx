"use client";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLeadsPage } from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import type { Lead } from "@/lib/data/types";

export function showingContactLabel(contact: Pick<Lead, "name" | "phone" | "email">): string { return [contact.name, contact.phone || contact.email].filter(Boolean).join(" · "); }
export function ShowingContactPicker({ selected, onChange, disabled }: { selected: Lead | null; onChange: (contact: Lead) => void; disabled?: boolean }) {
  const prefix = useId(), [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1), [loaded, setLoaded] = useState<{ query: string; items: Lead[] }>({ query: "", items: [] });
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const rows = useQuery(async () => ({ query, requestedPage: page, result: await getLeadsPage({ q: query || undefined, page, pageSize: 25, sort: "name", dir: "asc" }) }), [query, page]);
  const answer = rows.data?.query === query && rows.data.requestedPage === page ? rows.data.result : null;
  useEffect(() => { if (answer) setLoaded((previous) => ({ query, items: answer.page === 1 || previous.query !== query ? answer.items : [...previous.items.filter((row) => !answer.items.some((next) => next.id === row.id)), ...answer.items] })); }, [answer, query]);
  const searching = search.trim() !== query || loaded.query !== query;
  const contacts = searching ? [] : loaded.items;
  const choices = selected && !contacts.some((contact) => contact.id === selected.id) ? [selected, ...contacts] : contacts;
  return <div className="min-w-0 space-y-3"><div className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-search`}>Find a contact</Label><Input id={`${prefix}-search`} type="search" value={search} disabled={disabled} placeholder="Name, phone or email" maxLength={120} className="h-10" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setQuery(search.trim()); setPage(1); } }} /></div><div className="grid min-w-0 gap-1.5"><Label htmlFor={`${prefix}-contact`}>Contact · required</Label><Select value={selected?.id ?? ""} disabled={disabled || choices.length === 0} onValueChange={(id) => { const contact = choices.find((row) => row.id === id); if (contact) onChange(contact); }}><SelectTrigger id={`${prefix}-contact`} className="h-11 min-w-0"><SelectValue placeholder={rows.loading || searching ? "Searching contacts…" : "Choose a contact"} /></SelectTrigger><SelectContent className="max-w-[calc(100vw-2rem)]">{choices.map((contact) => <SelectItem key={contact.id} value={contact.id} className="min-h-10 max-w-[28rem] break-words [overflow-wrap:anywhere]">{showingContactLabel(contact)}</SelectItem>)}</SelectContent></Select></div>{selected && <p className="break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">Selected: <strong className="font-medium text-foreground">{showingContactLabel(selected)}</strong></p>}{rows.error && <div role="alert" className="text-xs leading-relaxed text-destructive">Contacts could not be loaded. Your selection is kept. <button type="button" className="min-h-10 px-1 font-semibold underline underline-offset-4" disabled={disabled} onClick={rows.refetch}>Retry contacts</button></div>}{!rows.loading && !searching && answer?.total === 0 && <p className="text-xs text-muted-foreground">No contacts match this search.</p>}{!searching && answer && answer.page * answer.pageSize < answer.total && <Button type="button" size="sm" variant="outline" disabled={disabled || rows.loading} onClick={() => setPage(answer.page + 1)}>Load more contacts</Button>}{searching && <p role="status" className="text-xs text-muted-foreground">Searching contacts…</p>}<p className="text-[11px] leading-relaxed text-muted-foreground">Only contacts you can already access are available. Planning a showing does not change contact access.</p></div>;
}

"use client";

/**
 * The client of a new transaction: a contact at Representation, or — for a deal
 * with no contact record — a typed name.
 *
 * The list comes from the server, already limited to what this person may open a
 * deal for (Representation, within their own Contacts scope, at most 25) and
 * narrowed by the name typed here; nothing is downloaded and filtered in the
 * browser. Choosing a contact submits only its id — the server reloads it and
 * builds the client from what is stored, so this control cannot be used to name
 * someone else's contact or to invent one.
 *
 * A native radio group, so arrow keys, labels and screen readers work without
 * bespoke code. The stored need of the chosen contact is shown as context and
 * suggests a side only when a need states one explicitly; nothing else is filled in.
 */
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getEligibleContacts, getNeeds } from "@/lib/data/adapters/leads";
import { summarizeNeed, type NeedView } from "@/lib/contacts/needs";

const MANUAL = "__manual__";

export function ContactPicker({
  preselected,
  onSuggestSide,
}: {
  /** Set when the deal is opened from a contact: no choice to make. */
  preselected?: { id: string; name: string } | null;
  onSuggestSide?: (side: "listing" | "buyer" | null) => void;
}) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<{ id: string; name: string }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<string>(preselected?.id ?? "");
  const [needs, setNeeds] = useState<NeedView[]>([]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(text.trim()), 250);
    return () => window.clearTimeout(id);
  }, [text]);

  useEffect(() => {
    if (preselected) return;
    let live = true;
    setFailed(false);
    getEligibleContacts(debounced || undefined)
      .then((rows) => live && setItems(rows))
      .catch(() => live && (setFailed(true), setItems([])));
    return () => {
      live = false;
    };
  }, [debounced, preselected]);

  const contactId = choice && choice !== MANUAL ? choice : "";

  // What the chosen person has said they want — as context, and as a side only when it is explicit.
  useEffect(() => {
    let live = true;
    if (!contactId) {
      setNeeds([]);
      onSuggestSide?.(null);
      return;
    }
    getNeeds(contactId)
      .then((rows) => {
        if (!live) return;
        const active = rows.filter((n) => n.status === "active");
        setNeeds(active);
        const kinds = new Set(active.map((n) => n.kind));
        onSuggestSide?.(kinds.size === 1 && kinds.has("buy") ? "buyer" : kinds.size === 1 && kinds.has("sell") ? "listing" : null);
      })
      .catch(() => live && (setNeeds([]), onSuggestSide?.(null)));
    return () => {
      live = false;
    };
    // onSuggestSide is a setter; it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const manual = choice === MANUAL || (!preselected && items !== null && items.length === 0 && !debounced && !choice);

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium leading-none">Client</legend>
      {contactId && <input type="hidden" name="contactId" value={contactId} />}

      {preselected ? (
        <p className="mt-1.5 text-sm" data-testid="picked-contact">
          {preselected.name}
        </p>
      ) : (
        <>
          <div className="mt-1.5 grid gap-1.5">
            <Label htmlFor="qc-contact-search" className="font-normal text-muted-foreground">
              Search contacts at Representation
            </Label>
            <Input id="qc-contact-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name" autoComplete="off" />
          </div>
          <div role="radiogroup" aria-label="Contacts at Representation" className="max-h-40 overflow-y-auto rounded-panel border border-border">
            {items === null ? (
              <p className="p-2 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                {failed && <p className="p-2 text-sm text-muted-foreground">Contacts could not be loaded.</p>}
                {items.length === 0 && !failed && (
                  <p className="p-2 text-sm text-muted-foreground">
                    {debounced ? "No matching contact at Representation." : "No contacts at Representation yet."}
                  </p>
                )}
                {items.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-tint">
                    <input type="radio" name="client-choice" value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} />
                    <span className="break-words">{c.name}</span>
                  </label>
                ))}
              </>
            )}
            <label className="flex cursor-pointer items-center gap-2 border-t border-border px-2 py-1.5 text-sm hover:bg-tint">
              <input type="radio" name="client-choice" value={MANUAL} checked={manual} onChange={() => setChoice(MANUAL)} />
              <span>Not in Contacts — enter a client name</span>
            </label>
          </div>
        </>
      )}

      {manual && !preselected && (
        <div className="grid gap-1.5">
          <Label htmlFor="qc-client">Client name</Label>
          <Input id="qc-client" name="client" required placeholder="Client name" />
        </div>
      )}

      {contactId && needs.length > 0 && (
        <p className="text-[13px] text-muted-foreground" data-testid="picked-need">
          Client need: {needs.map((n) => [summarizeNeed(n).headline, ...summarizeNeed(n).lines.slice(0, 2)].join(" · ")).join("; ")}
        </p>
      )}
    </fieldset>
  );
}

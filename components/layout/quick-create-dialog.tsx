"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUiStore, QuickCreateKind } from "@/lib/stores/ui";
import { createListing } from "@/lib/data/adapters/listings";
import { createTransaction,type QuickCreateTransactionInput } from "@/lib/data/adapters/transactions";
import { createLead, LeadsError } from "@/lib/data/adapters/leads";
import { addDocument } from "@/lib/data/adapters/documents";
import { getTransactions } from "@/lib/data/adapters/transactions";
import { useQuery } from "@/lib/data/hooks";
import { SUBSYSTEM_COPY, unavailableSubsystem } from "@/components/common/subsystem-state";
import { Lead, LEAD_SOURCES_ORDER, LEAD_SOURCE_LABELS, PropertyType } from "@/lib/data/types";
import { transactionCreateAttempt, transactionCreateUncertain, type TransactionCreateAttempt } from "@/lib/transactions/create-attempt";
import { closeDateFromInput } from "@/lib/transactions/close-date";
import { isValidBirthday, MONTH_NAMES } from "@/lib/contacts/birthday";
import { ContactPicker } from "./contact-picker";

/** A birthday half-picked, or one that is not a real day. Raised before anything is sent. */
class BirthdayInputError extends Error {}

const TITLES: Record<QuickCreateKind, { title: string; description: string; cta: string; goto: string }> = {
  listing: {
    title: "New listing",
    description: "Adds a draft listing to inventory. Details can follow.",
    cta: "Add listing",
    goto: "/listings",
  },
  transaction: {
    title: "New transaction",
    description: "Open an opportunity file, then enter its agreed terms and deadlines.",
    cta: "Open file",
    goto: "/transactions",
  },
  lead: {
    title: "New contact",
    description: "Adds a person to your contacts. It opens right after, ready for a first follow-up and their needs.",
    cta: "Add contact",
    goto: "/contacts",
  },
  event: {
    title: "New calendar item",
    description: "Add a personal calendar item, or plan work from its connected record.",
    cta: "Add calendar item",
    goto: "/calendar?create=personal",
  },
  document: {
    title: "New document",
    description: "Files a document against a transaction.",
    cta: "File document",
    goto: "/documents",
  },
};

export function QuickCreateDialog({ allowedKinds }: { allowedKinds?: readonly QuickCreateKind[] } = {}) {
  const requestedKind = useUiStore((s) => s.quickCreate);
  const kind = requestedKind && (!allowedKinds || allowedKinds.includes(requestedKind)) ? requestedKind : null;
  const setKind = useUiStore((s) => s.setQuickCreate);
  const fromContact = useUiStore((s) => s.quickCreateContact);
  // A side is suggested only when the chosen contact's active need states one explicitly.
  const [side, setSide] = React.useState<"listing" | "buyer" | "gc">("listing");
  const suggestSide = React.useCallback((s: "listing" | "buyer" | null) => setSide(current=>current==="gc"?current:s??"listing"), []);
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const contactRequest = React.useRef<string | null>(null);
  const transactionRequest = React.useRef<TransactionCreateAttempt | null>(null);
  const [transactionUncertain, setTransactionUncertain] = React.useState(false);

  const meta = kind ? TITLES[kind] : null;

  const close = () => {
    setKind(null);
    setError(null);
    contactRequest.current = null;
    if (!transactionUncertain) transactionRequest.current = null;
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!kind || busy) return;
    let goto = meta!.goto;
    const form = new FormData(e.currentTarget);
    const get = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      if (kind === "listing") {
        await createListing({
          address: get("address"),
          city: get("city") || "Fort Lauderdale",
          listPrice: Number(get("price")) || 0,
          propertyType: (get("propertyType") || "singleFamily") as PropertyType,
          beds: Number(get("beds")) || 0,
          baths: Number(get("baths")) || 0,
          sqft: Number(get("sqft")) || 0,
        });
      } else if (kind === "transaction") {
        const chosenSide=(get("side")||side) as "listing"|"buyer"|"gc";
        const clientName=get("client")||fromContact?.name||"";
        const input:QuickCreateTransactionInput=chosenSide==="gc"?{
          address:get("address"),clientName,contactId:get("contactId")||undefined,side:"gc"
        }:{
          address:get("address"),city:get("city")||"Fort Lauderdale",clientName,contactId:get("contactId")||undefined,side:chosenSide,contractPrice:Number(get("price"))||0,closeDate:closeDateFromInput(get("closeDate"))
        };
        const attempt = transactionCreateAttempt(transactionRequest.current, input, transactionUncertain);
        transactionRequest.current = attempt;
        const created = await createTransaction(attempt.input);
        transactionRequest.current = null;
        setTransactionUncertain(false);
        goto = created.source === "db" ? `/transactions/${encodeURIComponent(created.id)}` : `/transactions?open=${encodeURIComponent(created.id)}`;
      } else if (kind === "lead") {
        const month = Number(get("birthdayMonth") || 0);
        const day = Number(get("birthdayDay") || 0);
        // Both or neither, and a day that exists in that month (February 29 is fine — no year is kept).
        if ((month || day) && !isValidBirthday(month, day)) {
          throw new BirthdayInputError();
        }
        const created = await createLead({
          requestId: contactRequest.current ?? (contactRequest.current = crypto.randomUUID()),
          name: get("name"),
          email: get("email"),
          phone: get("phone"),
          source: (get("source") || undefined) as Lead["source"] | undefined,
          birthday: month && day ? { month, day } : undefined,
        });
        // Land on the new person, open, ready to schedule the first follow-up.
        goto = `/contacts?open=${encodeURIComponent(created.id)}`;
      } else if (kind === "event") {
        goto = "/calendar?create=personal";
      } else if (kind === "document") {
        const txnId = get("transactionId");
        const txns = await getTransactions();
        const txn = txns.find((t) => t.id === txnId) ?? txns[0];
        if (!txn) throw new Error("No transaction to file against");
        await addDocument({
          transactionId: txn.id,
          address: txn.address,
          name: get("name"),
          kind: "disclosure",
        });
      }
      close();
      router.push(goto);
    } catch (e) {
      // "Check the fields" is wrong when there is nothing wrong with the
      // fields: an event or a document has nowhere to be saved to here.
      if (kind === "transaction" && transactionRequest.current && transactionCreateUncertain(e, transactionUncertain)) {
        setTransactionUncertain(true);
        setError(transactionUncertain
          ? "The original save is still unconfirmed. Check the same result again when access is available; the submitted file is kept here."
          : "The new file may have been saved, but its result did not return. Check the same save result before creating another file.");
        return;
      }
      if (kind === "transaction") setTransactionUncertain(false);
      const missing = unavailableSubsystem(e);
      setError(
        e instanceof BirthdayInputError
          ? "Pick a real birthday date (month and day), or leave both empty."
          : missing
            ? SUBSYSTEM_COPY[missing].title
            : e instanceof LeadsError && e.code === "request_conflict"
              ? "This request may already have created a contact. Check Contacts before starting a new entry."
              : e instanceof LeadsError && e.status === 400 && e.fields.includes("contactId")
              ? "That contact is no longer eligible for a new transaction."
              : "Could not save. Check the fields and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && !busy && close()}>
      {/* Opened from the New menu, whose item is gone by the time this closes: focus goes back to the menu's button. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto" focusFallback={() => document.querySelector<HTMLElement>("[data-new-trigger]")}>
        {meta && kind && (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{meta.title}</DialogTitle>
              <DialogDescription>{kind==="transaction"&&side==="gc"?"Open a general contractor file with only the property address and client.":meta.description}</DialogDescription>
            </DialogHeader>

            {kind === "listing" && (
              <div className="grid gap-3">
                <Field label="Address" name="address" required placeholder="1200 Bayview Dr" />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City" name="city" placeholder="Fort Lauderdale" />
                  <Field label="List price" name="price" type="number" required placeholder="1250000" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Beds" name="beds" type="number" placeholder="3" />
                  <Field label="Baths" name="baths" type="number" placeholder="2" />
                  <Field label="Sqft" name="sqft" type="number" placeholder="2100" />
                </div>
                <SelectField
                  label="Property type"
                  name="propertyType"
                  defaultValue="singleFamily"
                  options={[
                    ["singleFamily", "Single family"],
                    ["condo", "Condo"],
                    ["townhouse", "Townhouse"],
                    ["multiFamily", "Multi-family"],
                    ["land", "Land"],
                  ]}
                />
              </div>
            )}

            {kind === "transaction" && transactionUncertain && transactionRequest.current && <div role="status" className="space-y-2 rounded-panel border border-border bg-tint p-4"><p className="text-sm font-semibold">Check the submitted file</p><p className="break-words text-sm">{[transactionRequest.current.input.address,transactionRequest.current.input.city].filter(Boolean).join(", ")}</p><p className="break-words text-xs text-muted-foreground">Client: {transactionRequest.current.input.clientName||"Linked contact"}</p><p className="text-xs leading-relaxed text-muted-foreground">The submitted values are kept unchanged. Checking the result uses the same request and will not create a duplicate. If you close this popup, the pending check remains available when you reopen New transaction.</p></div>}
            {kind === "transaction" && !transactionUncertain && (
              <TransactionCreateFields side={side} onSideChange={setSide} preselected={fromContact} onSuggestSide={suggestSide} disabled={busy}/>
            )}

            {kind === "lead" && (
              <div className="grid gap-3">
                <Field label="Name" name="name" required placeholder="Full name" />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email" name="email" type="email" placeholder="name@example.com" />
                  <Field label="Phone" name="phone" placeholder="(954) 555-0100" />
                </div>
                <SelectField
                  label="Source (optional)"
                  name="source"
                  defaultValue="other"
                  options={LEAD_SOURCES_ORDER.map((s) => [s, LEAD_SOURCE_LABELS[s]] as [string, string])}
                />
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    label="Birthday month (optional)"
                    name="birthdayMonth"
                    defaultValue="0"
                    options={[["0", "Not set"], ...MONTH_NAMES.map((n, i) => [String(i + 1), n] as [string, string])]}
                  />
                  <SelectField
                    label="Birthday day"
                    name="birthdayDay"
                    defaultValue="0"
                    options={[["0", "Not set"], ...Array.from({ length: 31 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])]}
                  />
                </div>
              </div>
            )}

            {kind === "event" && (
              <div className="grid gap-3 text-sm">
                <p className="leading-relaxed text-muted-foreground">Add your own meeting, reminder or appointment. You can also plan a showing from a saved property, set a client next action, or add a transaction deadline.</p>
                <div className="flex flex-wrap gap-2">
                  {[['/showing-tours', 'Tour plans'], ['/contacts', 'Client next actions'], ['/transactions', 'Transaction deadlines']].map(([href,label]) => <Button key={href} type="button" variant="outline" onClick={() => { close(); router.push(href); }}>{label}</Button>)}
                </div>
              </div>
            )}

            {kind === "document" && <DocumentFields />}

            {error && <p className="text-sm text-status-bad">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : kind === "transaction" && transactionUncertain ? "Check save result" : meta.cta}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TransactionCreateFields({side,onSideChange,preselected,onSuggestSide,disabled}:{side:"listing"|"buyer"|"gc";onSideChange:(side:"listing"|"buyer"|"gc")=>void;preselected?:{id:string;name:string}|null;onSuggestSide?:(side:"listing"|"buyer"|null)=>void;disabled?:boolean}){return <fieldset disabled={disabled} className="grid gap-3">
                <div className="grid gap-1.5"><Label htmlFor="qc-side">Side</Label><Select name="side" value={side} onValueChange={value=>{if(value==="listing"||value==="buyer"||value==="gc")onSideChange(value);}}><SelectTrigger id="qc-side"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="listing">Listing side</SelectItem><SelectItem value="buyer">Buyer side</SelectItem><SelectItem value="gc">GC / General contractor</SelectItem></SelectContent></Select></div>
                <Field label="Property address" name="address" required placeholder="2416 NE 26th St" />
                {side==="gc"?<>{preselected?<div className="space-y-2"><Label>Client</Label><input type="hidden" name="contactId" value={preselected.id}/><p className="break-words text-sm">{preselected.name}</p></div>:<Field label="Client" name="client" required placeholder="Client name"/>}<p className="text-xs leading-relaxed text-muted-foreground">Open a GC file with its property and client. The project checklist starts empty.</p></>:<><Field label="City" name="city" placeholder="Fort Lauderdale"/><ContactPicker preselected={preselected} onSuggestSide={onSuggestSide}/><div className="grid grid-cols-2 gap-3"><Field label="Contract price" name="price" type="number" required placeholder="1185000"/><Field label="Close date (optional)" name="closeDate" type="date"/></div></>}
              </fieldset>;}

function Field({
  label,
  name,
  ...props
}: { label: string; name: string } & React.ComponentProps<typeof Input>) {
  const id = `qc-${name}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} {...props} />
    </div>
  );
}

function SelectField({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: [string, string][];
  defaultValue: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`qc-${name}`}>{label}</Label>
      <Select name={name} defaultValue={defaultValue}>
        <SelectTrigger id={`qc-${name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([value, text]) => (
            <SelectItem key={value} value={value}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DocumentFields() {
  const { data: txns } = useQuery(() => getTransactions(), []);
  return (
    <div className="grid gap-3">
      <Field label="Document name" name="name" required placeholder="Seller's property disclosure" />
      <div className="grid gap-1.5">
        <Label htmlFor="qc-transactionId">Transaction</Label>
        <Select name="transactionId" defaultValue={txns?.[0]?.id}>
          <SelectTrigger id="qc-transactionId">
            <SelectValue placeholder="Select a file" />
          </SelectTrigger>
          <SelectContent>
            {(txns ?? []).slice(0, 20).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.address} — {t.clientName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

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
import { createTransaction } from "@/lib/data/adapters/transactions";
import { createLead, LeadsError } from "@/lib/data/adapters/leads";
import { createEvent } from "@/lib/data/adapters/calendar";
import { addDocument } from "@/lib/data/adapters/documents";
import { getTransactions } from "@/lib/data/adapters/transactions";
import { useQuery } from "@/lib/data/hooks";
import { SUBSYSTEM_COPY, unavailableSubsystem } from "@/components/common/subsystem-state";
import { EventType, Lead, LEAD_SOURCES_ORDER, LEAD_SOURCE_LABELS, PropertyType } from "@/lib/data/types";
import { now } from "@/lib/dates";
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
    description: "Opens a file at the offer stage.",
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
    title: "New event",
    description: "Adds an event to the calendar.",
    cta: "Add event",
    goto: "/calendar",
  },
  document: {
    title: "New document",
    description: "Files a document against a transaction.",
    cta: "File document",
    goto: "/documents",
  },
};

export function QuickCreateDialog() {
  const kind = useUiStore((s) => s.quickCreate);
  const setKind = useUiStore((s) => s.setQuickCreate);
  const fromContact = useUiStore((s) => s.quickCreateContact);
  // A side is suggested only when the chosen contact's active need states one explicitly.
  const [side, setSide] = React.useState<"listing" | "buyer">("listing");
  const suggestSide = React.useCallback((s: "listing" | "buyer" | null) => setSide(s ?? "listing"), []);
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const meta = kind ? TITLES[kind] : null;

  const close = () => {
    setKind(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!kind) return;
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
        await createTransaction({
          address: get("address"),
          city: get("city") || "Fort Lauderdale",
          clientName: get("client"),
          contactId: get("contactId") || undefined,
          side: (get("side") || "listing") as "listing" | "buyer",
          contractPrice: Number(get("price")) || 0,
          // Blank stays unset: no invented closing date, so no invented
          // "Closing" deadline. An entered day becomes the real one.
          closeDate: closeDateFromInput(get("closeDate")),
        });
      } else if (kind === "lead") {
        const month = Number(get("birthdayMonth") || 0);
        const day = Number(get("birthdayDay") || 0);
        // Both or neither, and a day that exists in that month (February 29 is fine — no year is kept).
        if ((month || day) && !isValidBirthday(month, day)) {
          throw new BirthdayInputError();
        }
        const created = await createLead({
          name: get("name"),
          email: get("email"),
          phone: get("phone"),
          source: (get("source") || undefined) as Lead["source"] | undefined,
          birthday: month && day ? { month, day } : undefined,
        });
        // Land on the new person, open, ready to schedule the first follow-up.
        goto = `/contacts?open=${encodeURIComponent(created.id)}`;
      } else if (kind === "event") {
        const date = get("date") || now().toISOString().slice(0, 10);
        const time = get("time") || "10:00";
        const start = new Date(`${date}T${time}:00`);
        await createEvent({
          type: (get("type") || "showing") as EventType,
          title: get("title"),
          address: get("address") || undefined,
          start: start.toISOString(),
          end: new Date(start.getTime() + 60 * 60000).toISOString(),
        });
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
      const missing = unavailableSubsystem(e);
      setError(
        e instanceof BirthdayInputError
          ? "Pick a real birthday date (month and day), or leave both empty."
          : missing
            ? SUBSYSTEM_COPY[missing].title
            : e instanceof LeadsError && e.status === 400 && e.fields.includes("contactId")
              ? "That contact is no longer eligible for a new transaction."
              : "Could not save. Check the fields and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && close()}>
      {/* Opened from the New menu, whose item is gone by the time this closes: focus goes back to the menu's button. */}
      <DialogContent focusFallback={() => document.querySelector<HTMLElement>("[data-new-trigger]")}>
        {meta && kind && (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{meta.title}</DialogTitle>
              <DialogDescription>{meta.description}</DialogDescription>
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

            {kind === "transaction" && (
              <div className="grid gap-3">
                <Field label="Property address" name="address" required placeholder="2416 NE 26th St" />
                <Field label="City" name="city" placeholder="Fort Lauderdale" />
                <ContactPicker preselected={fromContact} onSuggestSide={suggestSide} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Contract price" name="price" type="number" required placeholder="1185000" />
                  <Field label="Close date (optional)" name="closeDate" type="date" />
                </div>
                <SelectField
                  key={side}
                  label="Side"
                  name="side"
                  defaultValue={side}
                  options={[
                    ["listing", "Listing side"],
                    ["buyer", "Buyer side"],
                  ]}
                />
              </div>
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
              <div className="grid gap-3">
                <Field label="Title" name="title" required placeholder="Buyer showing" />
                <Field label="Address" name="address" placeholder="Optional" />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date" name="date" type="date" required />
                  <Field label="Time" name="time" type="time" defaultValue="10:00" />
                </div>
                <SelectField
                  label="Type"
                  name="type"
                  defaultValue="showing"
                  options={[
                    ["showing", "Showing"],
                    ["inspection", "Inspection"],
                    ["appraisal", "Appraisal"],
                    ["closing", "Closing"],
                    ["openHouse", "Open house"],
                    ["deadline", "Deadline"],
                  ]}
                />
              </div>
            )}

            {kind === "document" && <DocumentFields />}

            {error && <p className="text-sm text-status-bad">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : meta.cta}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

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

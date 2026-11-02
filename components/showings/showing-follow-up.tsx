"use client";

import Link from "next/link";
import { useState } from "react";
import { useSessionUser } from "@/components/layout/session-user";
import { leadAbilities } from "@/components/leads/lead-shared";
import { NextActionView } from "@/components/leads/next-action";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLead, getNextActionAssignees, LeadsError, updateNextAction } from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import type { NextActionMutation } from "@/lib/contacts/next-action";

/** Feedback has already saved. This deliberate second step edits the actual contact action. */
export function ShowingFollowUp({ contactId, onClose }: { contactId: string; onClose?: () => void }) {
  return <ContactFollowUp key={contactId} contactId={contactId} onClose={onClose} />;
}

function ContactFollowUp({ contactId, onClose }: { contactId: string; onClose?: () => void }) {
  const { data: contact, loading, error, refetch } = useQuery(() => getLead(contactId), [contactId]);
  const { canWrite } = leadAbilities(useSessionUser().role);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(input: NextActionMutation): Promise<boolean> {
    if (!contact || saving) return false;
    setSaving(true); setFailure(null); setNotice(null);
    try {
      const updated = await updateNextAction(contact.id, input);
      if (!updated) { setFailure("The contact is no longer available. Reload to review it."); return false; }
      setNotice("The contact’s next action is saved.");
      return true;
    } catch (cause) {
      if (cause instanceof LeadsError && (cause.status === 409 || cause.code === "invalid_assignee")) throw cause;
      setFailure("The action could not be confirmed. Reload the saved action before trying again. Your showing feedback is already saved.");
      return false;
    } finally { setSaving(false); refetch(); }
  }

  return <section className="min-w-0 space-y-3" aria-label="Showing follow-up">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-[15px] font-semibold">Choose the next step</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Review this contact’s current action before scheduling the follow-up.</p></div>
      {onClose && <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onClose}>Done</Button>}
    </div>
    {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {loading ? <Skeleton className="h-32 w-full rounded-panel" /> : error ? <div role="alert" className="rounded-panel border border-border p-4"><p className="text-sm">The contact’s action could not be loaded. Your feedback is saved.</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={refetch}>Retry</Button></div> : !contact ? <p className="text-sm text-muted-foreground">This contact is no longer available.</p> : <>
      <p className="text-xs"><Link className="font-semibold underline underline-offset-4" href={`/contacts?open=${encodeURIComponent(contact.id)}`}>{contact.name}</Link></p>
      <NextActionView lead={contact} canWrite={canWrite} available={contact.recordSource !== "sample"} saving={saving} onSave={save} loadAssignees={() => getNextActionAssignees(contact.id)} onReload={async () => { const fresh = await getLead(contact.id); refetch(); return fresh; }} />
    </>}
  </section>;
}

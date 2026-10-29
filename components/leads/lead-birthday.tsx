"use client";

/**
 * A contact's birthday: "March 17", or "Not set" — never "Unknown", which would
 * read as data. Set, change or clear it; there is no year to ask for and no age
 * is ever shown. The day list follows the month, so February 30 and April 31
 * cannot be picked (February 29 can: the year is unknown).
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { daysInMonth, formatBirthday, MONTH_NAMES, type Birthday } from "@/lib/contacts/birthday";
import { birthdayEditorChanged, birthdayEditorSnapshot, reviewBirthdayEditor } from "@/lib/contacts/birthday-editor";

export function LeadBirthday({
  value,
  revision,
  canWrite,
  saving,
  onSave,
}: {
  value: Birthday | null | undefined;
  revision?: string;
  canWrite: boolean;
  saving: boolean;
  /** Resolves true on success; a refusal is the caller's to explain. */
  onSave: (next: Birthday | null, expectedUpdatedAt?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [month, setMonth] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [baseline, setBaseline] = useState(() => birthdayEditorSnapshot(value, revision));
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const monthControl = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) monthControl.current?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  useEffect(() => { if (editing && notice) monthControl.current?.focus(); }, [editing, notice, baseline]);

  const shown = formatBirthday(value);

  function open() {
    setBaseline(birthdayEditorSnapshot(value, revision));
    setMonth(value ? String(value.month) : "");
    setDay(value ? String(value.day) : "");
    setFailure(null);
    setNotice(null);
    setEditing(true);
  }

  const m = Number(month);
  const days = m >= 1 ? daysInMonth(m) : 31;
  const ready = Boolean(month) && Boolean(day) && Number(day) <= days;
  const latest = birthdayEditorSnapshot(value, revision);
  const changedRemotely = editing && birthdayEditorChanged(baseline, latest);

  function review(choice: "saved" | "draft") {
    const result = reviewBirthdayEditor(ready ? { month: m, day: Number(day) } : null, latest, choice);
    setBaseline(result.baseline);
    if (choice === "saved") {
      setMonth(result.value ? String(result.value.month) : "");
      setDay(result.value ? String(result.value.day) : "");
    }
    setFailure(null);
    setNotice(choice === "saved" ? "Saved birthday loaded. Review the date before saving." : "Your birthday change is kept. Review the date before saving.");
  }

  async function save() {
    if (!ready || changedRemotely || saving) return;
    setFailure(null);
    try {
      if (await onSave({ month: m, day: Number(day) }, baseline.revision)) setEditing(false);
      else setFailure("Birthday could not be saved. Your draft is kept. Review any updated saved details before trying again.");
    } catch {
      setFailure("Birthday could not be saved. Your draft is kept. Try again.");
    }
  }

  async function clear() {
    setFailure(null);
    try {
      if (!(await onSave(null, revision))) setFailure("Birthday could not be cleared. Review the saved details and try again.");
    } catch {
      setFailure("Birthday could not be cleared. Try again.");
    }
  }

  return (
    <div data-testid="lead-birthday">
      <p className="text-[11px] leading-4 text-muted-foreground">Birthday</p>
      {changedRemotely && (
        <div role="alert" className="mt-3 space-y-2 rounded-panel border border-border bg-tint p-3">
          <p className="text-sm font-semibold">The saved contact changed while you were editing</p>
          <p className="text-xs leading-relaxed text-muted-foreground">Your draft is kept. Choose which birthday to use before saving.</p>
          <p className="text-xs">Saved birthday: {formatBirthday(value) ?? "Not set"}</p>
          <p className="text-xs">Your draft: {ready ? formatBirthday({ month: m, day: Number(day) }) : "Choose a month and day"}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => review("saved")}>Use saved birthday</Button>
            <Button type="button" size="sm" variant="outline" disabled={saving || !ready} onClick={() => review("draft")}>Keep my birthday change</Button>
          </div>
        </div>
      )}
      {failure && <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">{failure}</p>}
      {editing && notice && <p role="status" className="mt-2 text-xs leading-relaxed text-muted-foreground">{notice}</p>}
      {editing ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="lead-birthday-month">Month</Label>
            <Select
              value={month}
              onValueChange={(v) => {
                setMonth(v);
                // A day that does not exist in the new month is dropped, not silently kept.
                if (Number(day) > daysInMonth(Number(v))) setDay("");
              }}
              disabled={saving}
            >
              <SelectTrigger ref={monthControl} id="lead-birthday-month" className="w-36">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, i) => (
                  <SelectItem key={name} value={String(i + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-birthday-day">Day</Label>
            <Select value={day} onValueChange={setDay} disabled={saving || !month}>
              <SelectTrigger id="lead-birthday-day" className="w-24">
                <SelectValue placeholder="Day" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: days }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" size="sm" disabled={saving || !ready || changedRemotely} onClick={() => void save()}>
            Save birthday
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className={shown ? "text-sm font-semibold" : "text-sm text-muted-foreground"} data-testid="lead-birthday-value">
            {shown ?? "Not set"}
          </p>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button ref={editButton} type="button" size="sm" variant="outline" disabled={saving} onClick={open}>
                {shown ? "Change" : "Set"}
              </Button>
              {shown && (
                <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void clear()}>
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

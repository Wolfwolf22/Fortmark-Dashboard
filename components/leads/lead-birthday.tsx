"use client";

/**
 * A contact's birthday: "March 17", or "Not set" — never "Unknown", which would
 * read as data. Set, change or clear it; there is no year to ask for and no age
 * is ever shown. The day list follows the month, so February 30 and April 31
 * cannot be picked (February 29 can: the year is unknown).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { daysInMonth, formatBirthday, MONTH_NAMES, type Birthday } from "@/lib/contacts/birthday";

export function LeadBirthday({
  value,
  canWrite,
  saving,
  onSave,
}: {
  value: Birthday | null | undefined;
  canWrite: boolean;
  saving: boolean;
  /** Resolves true on success; a refusal is the caller's to explain. */
  onSave: (next: Birthday | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [month, setMonth] = useState<string>("");
  const [day, setDay] = useState<string>("");

  const shown = formatBirthday(value);

  function open() {
    setMonth(value ? String(value.month) : "");
    setDay(value ? String(value.day) : "");
    setEditing(true);
  }

  const m = Number(month);
  const days = m >= 1 ? daysInMonth(m) : 31;
  const ready = Boolean(month) && Boolean(day) && Number(day) <= days;

  async function save() {
    if (!ready) return;
    if (await onSave({ month: m, day: Number(day) })) setEditing(false);
  }

  return (
    <div data-testid="lead-birthday">
      <p className="text-micro">Birthday</p>
      {editing ? (
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
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
              <SelectTrigger id="lead-birthday-month" className="w-36">
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
          <Button type="button" size="sm" disabled={saving || !ready} onClick={() => void save()}>
            Save birthday
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className={shown ? "text-sm font-semibold" : "text-sm text-muted-foreground"} data-testid="lead-birthday-value">
            {shown ?? "Not set"}
          </p>
          {canWrite && (
            <>
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={open}>
                {shown ? "Change" : "Set"}
              </Button>
              {shown && (
                <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void onSave(null)}>
                  Clear
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

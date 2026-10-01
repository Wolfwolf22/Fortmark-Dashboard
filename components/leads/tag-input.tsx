"use client";

/**
 * A short list of short phrases — areas, must-haves — entered one at a time.
 *
 * Deliberately not a comma-separated text box: each entry is its own item, so
 * what is stored is a real list, and each can be removed on its own with a
 * button that says which one. Enter or the Add button commits an entry; a
 * comma does too, since people type them.
 */
import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TagInput({
  id,
  label,
  values,
  onChange,
  max,
  itemMax,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
  itemMax: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const full = values.length >= max;

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((p) => p.trim().slice(0, itemMax))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    }
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={full ? `Up to ${max}` : placeholder}
          maxLength={itemMax}
          disabled={disabled || full}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => commit(draft)} disabled={disabled || full || !draft.trim()}>
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label} added`}>
          {values.map((v) => (
            <li key={v} className="inline-flex items-center gap-1 rounded-full bg-tint py-0.5 pl-2.5 pr-1 text-[13px]">
              <span className="break-words">{v}</span>
              <button
                type="button"
                aria-label={`Remove ${v}`}
                disabled={disabled}
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

/**
 * One profile field, rendered from the shared metadata table.
 *
 * Both the onboarding wizard and the settings editor use this, so a field's
 * label, hint, input type and length limit cannot drift between the two
 * surfaces. Nothing here validates — the server normalises and validates, and
 * this component only reports what the server said.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fieldMeta } from "@/lib/profile/fields";
import type { ProfileFieldKey } from "@/lib/profile/onboarding";
import { cn } from "@/lib/utils";

export interface ProfileFieldProps {
  name: ProfileFieldKey;
  /** Uncontrolled use — the wizard reads values back with FormData. */
  defaultValue?: string | null;
  /**
   * Controlled use — the settings editor keeps form state itself.
   *
   * Supporting both is what lets one component serve both surfaces. Forking it
   * into a controlled and an uncontrolled copy is how the two forms would
   * start to drift again.
   */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Server-reported message for this field. Announced via aria-describedby. */
  error?: string | null;
  disabled?: boolean;
}

export function ProfileField({
  name,
  defaultValue,
  value,
  onValueChange,
  error,
  disabled,
}: ProfileFieldProps) {
  const meta = fieldMeta(name);
  const id = `field-${name}`;
  const hintId = meta.hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  // Both are referenced so a screen reader reads the rule AND the failure,
  // rather than the error replacing the explanation of what was wanted.
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const controlled = value !== undefined;
  const common = {
    id,
    name,
    ...(controlled
      ? { value, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onValueChange?.(e.target.value) }
      : { defaultValue: defaultValue ?? "" }),
    maxLength: meta.maxLength,
    disabled,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": describedBy,
    className: cn(error && "border-destructive focus-visible:ring-destructive"),
  };

  return (
    <div className="space-y-1.5">
      {/* Always visible — never a placeholder standing in for a label. */}
      <Label htmlFor={id}>{meta.label}</Label>

      {meta.kind === "textarea" ? (
        <Textarea {...common} rows={4} placeholder={meta.placeholder} />
      ) : (
        <Input
          {...common}
          type={meta.kind === "date" ? "date" : meta.kind === "url" ? "text" : meta.kind}
          inputMode={meta.kind === "tel" ? "tel" : undefined}
          placeholder={meta.placeholder}
          autoComplete={meta.autoComplete}
        />
      )}

      {meta.hint && (
        <p id={hintId} className="text-[12px] text-foreground/55">
          {meta.hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[12px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A labelled, non-editable value. Used for the verified account email. */
export function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const id = `readonly-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {/* `readOnly` rather than `disabled`: the value stays selectable and is
          still announced, but cannot be edited or submitted. */}
      <Input id={id} value={value} readOnly aria-readonly className="bg-foreground/[0.04]" />
      {hint && <p className="text-[12px] text-foreground/55">{hint}</p>}
    </div>
  );
}

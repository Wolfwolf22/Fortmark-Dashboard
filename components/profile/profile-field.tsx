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
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fieldMeta, type FieldOption } from "@/lib/profile/fields";
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
  // What the control is currently showing, whichever mode it is in. Needed
  // before render so a legacy value can be added to the option list.
  const currentValue = (controlled ? value : (defaultValue ?? "")) || "";
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

      {meta.kind === "select" ? (
        <SelectControl
          {...common}
          options={widenOptions(meta.options ?? [], currentValue)}
          onSelectChange={onValueChange}
          controlled={controlled}
          currentValue={currentValue}
        />
      ) : meta.kind === "textarea" ? (
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

/**
 * Add the current value to an option list when the catalogue does not contain
 * it.
 *
 * This is the backward-compatibility guarantee for every select field. A row
 * written before the catalogue existed holds free text; without this the
 * control would render with nothing selected, and the next save would post ""
 * and quietly erase a value the user never touched.
 *
 * Generic rather than per-field on purpose — a new select gets the same
 * protection without anyone remembering to wire it up.
 */
export function widenOptions(
  options: readonly FieldOption[],
  current: string
): readonly FieldOption[] {
  const value = current.trim();
  if (value.length === 0) return options;
  if (options.some((o) => o.value === value)) return options;
  return [{ value, label: value }, ...options];
}

/**
 * A native `<select>`, deliberately.
 *
 * The design system's Radix select is used elsewhere, but this control has to
 * satisfy two things Radix would complicate: the onboarding wizard reads its
 * form back with `new FormData(form)`, which only sees real form controls, and
 * the field must stay usable by keyboard and by a mobile picker with no extra
 * work. A native select gives both for free, and styling it to match `Input`
 * costs one `appearance-none` and a chevron.
 */
function SelectControl({
  options,
  onSelectChange,
  controlled,
  currentValue,
  className,
  value: _value,
  defaultValue: _defaultValue,
  onChange: _onChange,
  maxLength: _maxLength,
  ...rest
}: {
  options: readonly FieldOption[];
  onSelectChange?: (value: string) => void;
  controlled: boolean;
  currentValue: string;
  className?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  maxLength?: number;
} & Omit<React.ComponentProps<"select">, "value" | "defaultValue" | "onChange">) {
  return (
    <div className="relative">
      <select
        {...rest}
        {...(controlled
          ? { value: currentValue, onChange: (e) => onSelectChange?.(e.target.value) }
          : { defaultValue: currentValue })}
        className={cn(
          "flex h-9 w-full appearance-none rounded-lg border border-input bg-card px-3 py-1 pr-9 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      >
        {/* An explicit empty choice, so "not answered" stays reachable — every
            profile field is optional, and a select with no blank option would
            force a value the user never chose. */}
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

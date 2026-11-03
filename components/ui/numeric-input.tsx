"use client";

import * as React from "react";
import { groupNumericDraft, numericCaret, numericConstraintMessage, numericDraft } from "@/lib/number-input";

/** The visible field is grouped; existing change handlers and native FormData receive raw numbers. */
export const NumericInput = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type">>(
  ({ value, defaultValue, onChange, onBlur, inputMode = "decimal", ...props }, forwardedRef) => {
    const input = React.useRef<HTMLInputElement>(null);
    const [uncontrolled, setUncontrolled] = React.useState(() => numericDraft(String(defaultValue ?? "")) ?? "");
    const raw = value === undefined ? uncontrolled : numericDraft(String(value ?? "")) ?? String(value ?? "");
    const current = React.useRef(raw);
    current.current = raw;
    React.useImperativeHandle(forwardedRef, () => input.current!, []);

    // Native form submissions and new FormData(form) must retain the same ungrouped contract.
    React.useEffect(() => {
      const node = input.current, form = node?.form;
      if (!node || !form || !node.name) return;
      function serialize(event: FormDataEvent) {
        if (node && !node.matches(":disabled") && event.formData.has(node.name)) event.formData.set(node.name, current.current);
      }
      form.addEventListener("formdata", serialize);
      return () => form.removeEventListener("formdata", serialize);
    }, [props.name, props.form]);

    React.useEffect(() => {
      input.current?.setCustomValidity(numericConstraintMessage(raw, props));
    }, [raw, props.min, props.max, props.step]);

    function change(event: React.ChangeEvent<HTMLInputElement>) {
      const node = event.currentTarget, typed = node.value, caret = node.selectionStart ?? typed.length;
      const inputType = (event.nativeEvent as InputEvent).inputType;
      // Existing presentation commas can be displaced by an ordinary edit;
      // pasted/replaced text must already use valid grouping and symbol positions.
      const editing = inputType === "insertText" || inputType?.startsWith("delete");
      let next = numericDraft(editing ? typed.replaceAll(",", "") : typed);
      if (next === null || next.length > 128) { node.value = groupNumericDraft(current.current); return; }
      let meaningful = typed.slice(0, caret).replace(/,/g, "").length;
      // Backspacing a separator should remove a digit, rather than put the comma straight back.
      if (next === current.current && (event.nativeEvent as InputEvent).inputType === "deleteContentBackward" && caret > 0) {
        next = numericDraft(next.slice(0, meaningful - 1) + next.slice(meaningful)) ?? "";
        meaningful--;
      }
      current.current = next;
      if (value === undefined) setUncontrolled(next);
      // Preserve the normal React event contract for the existing synchronous field handlers.
      node.value = next;
      try { onChange?.(event); }
      finally {
        node.value = groupNumericDraft(next);
        const position = numericCaret(node.value, meaningful);
        node.setSelectionRange(position, position);
        node.setCustomValidity(numericConstraintMessage(next, props));
      }
    }

    function blur(event: React.FocusEvent<HTMLInputElement>) {
      const node = event.currentTarget, displayed = node.value;
      node.value = current.current;
      try { onBlur?.(event); } finally { node.value = displayed; }
    }

    return <input {...props} ref={input} type="text" inputMode={inputMode} value={groupNumericDraft(raw)} onChange={change} onBlur={blur} data-numeric-input="grouped" />;
  }
);
NumericInput.displayName = "NumericInput";

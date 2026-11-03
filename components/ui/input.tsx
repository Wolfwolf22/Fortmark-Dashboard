import * as React from "react";
import { cn } from "@/lib/utils";
import { NumericInput } from "./numeric-input";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const classes = cn(
          "flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className
        );
    if (type === "number" || props.inputMode === "decimal" && (!type || type === "text")) return <NumericInput {...props} ref={ref} className={classes} />;
    return (
      <input
        type={type}
        className={classes}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };

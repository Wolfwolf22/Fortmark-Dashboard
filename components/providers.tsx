"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * ClerkProvider wraps the theme and tooltip providers so Clerk's client hooks
 * (`useClerk`, `useAuth`) are available everywhere, while the existing
 * ThemeProvider → TooltipProvider hierarchy is preserved unchanged beneath it.
 *
 * There is exactly one ClerkProvider in this zone. The portal app has its own
 * for its own zone; they never render together, so no two instances compete.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}

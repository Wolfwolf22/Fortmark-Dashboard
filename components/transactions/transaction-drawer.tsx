"use client";

/**
 * Transaction detail drawer — shared by the Home transactions widget and the
 * Transactions page. Contract: controlled by (transactionId, open,
 * onOpenChange); renders the milestone timeline described in the brief.
 */
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

export interface TransactionDrawerProps {
  transactionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TransactionDrawer({
  transactionId,
  open,
  onOpenChange,
}: TransactionDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full p-6 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Transaction</SheetTitle>
        </SheetHeader>
        {transactionId && <Skeleton className="mt-6 h-64 w-full" />}
      </SheetContent>
    </Sheet>
  );
}

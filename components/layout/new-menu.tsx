"use client";

import {
  Building2,
  CalendarPlus,
  FilePlus2,
  Plus,
  UserPlus,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUiStore } from "@/lib/stores/ui";
import { QuickCreateDialog } from "./quick-create-dialog";

/** The "New" action menu — each entry opens the working quick-create dialog. */
export function NewMenu() {
  const setQuickCreate = useUiStore((s) => s.setQuickCreate);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Outline, not filled: in the top bar the only solid white element
              should be the selected section. Icon-only until xl. */}
          <Button variant="outline" className="h-9 w-9 px-0 xl:w-auto xl:px-3" aria-label="New">
            <Plus />
            <span className="hidden xl:inline">New</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setQuickCreate("listing")}>
            <Building2 />
            Listing
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setQuickCreate("transaction")}>
            <Workflow />
            Transaction
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setQuickCreate("lead")}>
            <UserPlus />
            Lead
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setQuickCreate("event")}>
            <CalendarPlus />
            Calendar event
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setQuickCreate("document")}>
            <FilePlus2 />
            Document
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <QuickCreateDialog />
    </>
  );
}

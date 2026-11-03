"use client";

import {
  Building2,
  CalendarPlus,
  FilePlus2,
  Plus,
  UserPlus,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUiStore } from "@/lib/stores/ui";
import { useSessionUser } from "./session-user";
import { useCreationCapabilities,canQuickCreate } from "./creation-capabilities";
import { QuickCreateDialog } from "./quick-create-dialog";

/** The "New" action menu — each entry opens the working quick-create dialog. */
export function NewMenu() {
  const setQuickCreate = useUiStore((s) => s.setQuickCreate);
  const router = useRouter();
  const capabilities=useCreationCapabilities(),role=useSessionUser().role,can=(kind:Parameters<typeof canQuickCreate>[0])=>canQuickCreate(kind,capabilities,role);
  const showLauncher=["listing","transaction","lead","event","document"].some(kind=>can(kind as Parameters<typeof can>[0]));

  return (
    <>
      {showLauncher&&<DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* One clear creation action; supporting utilities stay quiet. */}
          <Button className="h-11 w-11 shrink-0 px-0 md:w-auto md:px-3" aria-label="New" data-new-trigger>
            <Plus />
            <span className="hidden md:inline">New</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {can("listing")&&<DropdownMenuItem onSelect={() => setQuickCreate("listing")}>
            <Building2 />
            Sample listing
          </DropdownMenuItem>}
          {can("transaction")&&<DropdownMenuItem onSelect={() => setQuickCreate("transaction")}>
            <Workflow />
            Transaction
          </DropdownMenuItem>}
          {can("lead")&&<DropdownMenuItem onSelect={() => setQuickCreate("lead")}>
            <UserPlus />
            Contact
          </DropdownMenuItem>}
          {can("event")&&<DropdownMenuItem onSelect={() => router.push("/calendar?create=personal")}>
            <CalendarPlus />
            Calendar item
          </DropdownMenuItem>}
          {can("document")&&<DropdownMenuItem onSelect={() => setQuickCreate("document")}>
            <FilePlus2 />
            Sample document
          </DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>}
      <QuickCreateDialog key="quick-create-dialog" />
    </>
  );
}

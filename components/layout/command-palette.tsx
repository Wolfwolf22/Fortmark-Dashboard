"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, User, Workflow } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NAV_ITEMS } from "./nav-items";
import { useUiStore } from "@/lib/stores/ui";
import { searchAll } from "@/lib/data/adapters/search";
import { SearchResult } from "@/lib/data/types";

const KIND_ICON = {
  listing: Building2,
  transaction: Workflow,
  contact: User,
} as const;

const KIND_LABEL = {
  listing: "Listings",
  transaction: "Transactions",
  contact: "Contacts",
} as const;

/**
 * ⌘K palette: navigation plus live search across listings, transactions,
 * and contacts via the search adapter.
 */
export function CommandPalette() {
  const router = useRouter();
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!useUiStore.getState().commandOpen);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setOpen]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      searchAll(query).then((r) => {
        if (!cancelled) setResults(r);
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const grouped = (["listing", "transaction", "contact"] as const)
    .map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length > 0);

  const navMatches = query
    ? NAV_ITEMS.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      )
    : NAV_ITEMS;

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search FortMark">
      <CommandInput
        placeholder="Search listings, transactions, people…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matches. Try an address, client, or MLS number.</CommandEmpty>
        {grouped.map((group) => {
          const Icon = KIND_ICON[group.kind];
          return (
            <CommandGroup key={group.kind} heading={KIND_LABEL[group.kind]}>
              {group.items.map((result) => (
                <CommandItem
                  key={result.id}
                  value={result.id}
                  onSelect={() => go(result.href)}
                >
                  <Icon />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{result.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {result.subtitle}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        <CommandGroup heading="Go to">
          {navMatches.map((item) => (
            <CommandItem
              key={item.href}
              value={`nav-${item.label}`}
              onSelect={() => go(item.href)}
            >
              <item.icon />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

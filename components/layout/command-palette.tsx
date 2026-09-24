"use client";

import * as React from "react";
import { useShellNavigate } from "./page-transition";
import { Plus } from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { NAV_ITEMS } from "./nav-items";
import { useUiStore } from "@/lib/stores/ui";
import { searchAll } from "@/lib/data/adapters/search";
import { ENTITY_ORDER, topResult } from "@/lib/search/rank";
import {
  MIN_QUERY_LENGTH,
  type ProviderStates,
  type SearchEntity,
  type SearchHit,
  type SearchResponse,
} from "@/lib/search/types";
import { ROUTES } from "@/lib/routes";

const ENTITY_HEADING: Record<SearchEntity, string> = {
  contact: "Contacts",
  transaction: "Transactions",
  listing: "Listings",
  agent: "Team",
};

/**
 * Quick actions.
 *
 * Commands, not search results: they are always available, never sent to a
 * database, and still work when every provider is down. The palette is a
 * launcher as much as a finder, and the launcher half must not depend on the
 * finder half.
 */
const ACTIONS = [
  { label: "Add a contact", href: ROUTES.leads },
  { label: "Create a transaction", href: ROUTES.transactions },
];

/** Debounce: long enough to skip intermediate keystrokes, short enough to feel live. */
const DEBOUNCE_MS = 140;

/** Still on the page, still able to take focus. */
function focusable(node: Element | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (!node.isConnected || node === document.body) return false;
  if (node.hasAttribute("disabled") || node.getAttribute("aria-hidden") === "true") return false;
  // A hidden element accepts focus() and then silently drops it back to body.
  return node.offsetParent !== null || node.getClientRects().length > 0;
}

/** The visible search control in the top bar — desktop or mobile, whichever is up. */
function searchTrigger(): HTMLElement | null {
  const triggers = Array.from(document.querySelectorAll<HTMLElement>("[data-command-trigger]"));
  return triggers.find(focusable) ?? null;
}

/**
 * ⌘K — FortMark's retrieval surface.
 *
 * Commands above, authorized records below. The records come from the unified
 * search service, so what appears here is exactly what the caller could open
 * on the underlying screen: no client-side filtering of a wider set, and no
 * generated brokerage behind it.
 *
 * Two things it is careful about. A slow answer can never overwrite a faster
 * one for a later query — each request carries an `AbortController` and a
 * sequence number. And a provider that could not answer is reported as such,
 * never as "no results", because telling an agent their client does not exist
 * when the database was merely unreachable is the worst lie this screen could
 * tell.
 */
export function CommandPalette() {
  const navigate = useShellNavigate();
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const [query, setQuery] = React.useState("");
  const [response, setResponse] = React.useState<SearchResponse | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  /**
   * Where focus came from, so it has somewhere to go back to.
   *
   * Radix restores focus to whatever was focused when the dialog opened, and
   * for ⌘K that is usually nothing at all: certification measured
   * `document.activeElement` as `<body>` after opening the palette by
   * keyboard and pressing Escape, which leaves someone working by keyboard
   * with no place on the page — the next Tab starts again from the top of
   * the document.
   *
   * So the opener is remembered here, and `restoreFocus` below decides:
   * whatever opened the palette if it is still on the page, otherwise the
   * search control in the top bar, which is where the palette conceptually
   * lives. Only if neither exists is Radix's own behaviour left alone.
   */
  const opener = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    opener.current = focusable(active) ? active : null;
  }, [open]);

  const restoreFocus = React.useCallback((event: Event) => {
    // Navigation unmounts the opener; the trigger outlives every route.
    const destination = focusable(opener.current) ? opener.current : searchTrigger();
    if (!destination) return;
    event.preventDefault();
    destination.focus();
  }, []);

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

  // The latest request wins, whatever order the answers arrive in.
  const sequence = React.useRef(0);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResponse(null);
      setFailed(false);
      setSearching(false);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResponse(null);
      setFailed(false);
      setSearching(false);
      return;
    }

    const ticket = ++sequence.current;
    const controller = new AbortController();
    setSearching(true);
    const handle = setTimeout(() => {
      searchAll(trimmed, controller.signal)
        .then((result) => {
          if (ticket !== sequence.current) return;
          setResponse(result);
          setFailed(false);
        })
        .catch(() => {
          if (ticket !== sequence.current) return;
          setResponse(null);
          setFailed(true);
        })
        .finally(() => {
          if (ticket === sequence.current) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query, open]);

  const go = (href: string) => {
    // Selecting a result navigates, which unmounts whatever opened the
    // palette — a row in a table, a link in a list. Forgetting the opener
    // here sends focus to the search control instead, which is part of the
    // shell and survives the route change; restoring to a element that is
    // about to disappear would drop focus on `<body>` a tick later.
    opener.current = null;
    setOpen(false);
    // Same exit motion as the top bar; still a real `router.push`.
    navigate(href);
  };

  const trimmed = query.trim();
  const searchable = trimmed.length >= MIN_QUERY_LENGTH;
  const hits = response?.hits ?? [];
  const lead = topResult(hits);
  const grouped = ENTITY_ORDER.map((entity) => ({
    entity,
    items: hits.filter((hit) => hit.entity === entity && hit.id !== lead?.id),
  })).filter((group) => group.items.length > 0);

  const navMatches = trimmed
    ? NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(trimmed.toLowerCase()))
    : NAV_ITEMS;
  const actionMatches = trimmed
    ? ACTIONS.filter((action) => action.label.toLowerCase().includes(trimmed.toLowerCase()))
    : ACTIONS;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search FortMark"
      onCloseAutoFocus={restoreFocus}
    >
      <CommandInput
        placeholder="Search people, deals, addresses…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {lead && (
          <CommandGroup heading="Top result">
            <Result hit={lead} onSelect={go} />
          </CommandGroup>
        )}

        {grouped.map((group) => (
          <CommandGroup key={group.entity} heading={ENTITY_HEADING[group.entity]}>
            {group.items.map((hit) => (
              <Result key={`${hit.entity}-${hit.id}`} hit={hit} onSelect={go} />
            ))}
          </CommandGroup>
        ))}

        {searchable && (
          <SearchState
            query={trimmed}
            searching={searching}
            failed={failed}
            response={response}
          />
        )}

        {(lead || grouped.length > 0) && <CommandSeparator />}

        {actionMatches.length > 0 && (
          <CommandGroup heading="Actions">
            {actionMatches.map((action) => (
              <CommandItem
                key={action.href + action.label}
                value={`action-${action.label}`}
                onSelect={() => go(action.href)}
              >
                <Plus />
                {action.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {navMatches.length > 0 && (
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
        )}
      </CommandList>
    </CommandDialog>
  );
}

/**
 * One record.
 *
 * `value` is unique per hit and `shouldFilter` is off on the dialog, so cmdk
 * never second-guesses the server's result set — what the service authorized
 * is exactly what is shown.
 */
function Result({ hit, onSelect }: { hit: SearchHit; onSelect: (href: string) => void }) {
  return (
    <CommandItem value={`${hit.entity}-${hit.id}`} onSelect={() => onSelect(hit.href)}>
      <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-semibold">{hit.title}</span>
          {hit.subtitle && (
            <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>
          )}
        </span>
        {hit.meta && (
          <span className="shrink-0 text-xs tabular text-muted-foreground">{hit.meta}</span>
        )}
      </span>
    </CommandItem>
  );
}

/** The domains a person would expect an answer from, in the order they read. */
const REPORTED: SearchEntity[] = ["contact", "transaction", "listing"];

const DEGRADED_LABEL: Record<SearchEntity, string> = {
  contact: "Contacts",
  transaction: "Transactions",
  listing: "MLS",
  agent: "Team",
};

/**
 * What to say when there is nothing to show.
 *
 * The distinction this draws is the whole point of the availability contract:
 * "we searched and found nothing" and "we could not search" must never read
 * the same way. A user told "no results" when the MLS was simply not connected
 * would conclude the property does not exist.
 */
function SearchState({
  query,
  searching,
  failed,
  response,
}: {
  query: string;
  searching: boolean;
  failed: boolean;
  response: SearchResponse | null;
}) {
  if (failed) {
    return <Note>Search is unavailable right now. Try again in a moment.</Note>;
  }
  if (searching && !response) {
    return <Note>Searching…</Note>;
  }
  if (!response) return null;

  const degraded = describeDegraded(response.providers);
  if (response.hits.length > 0) {
    return degraded ? <Note>{degraded}</Note> : null;
  }

  const searched = REPORTED.filter((entity) => response.providers[entity] === "available");
  const searchedLabel = searched.map((entity) => DEGRADED_LABEL[entity].toLowerCase());
  return (
    <Note>
      {searched.length === 0
        ? `Nothing could be searched for “${query}”.`
        : `No ${joinWords(searchedLabel)} match “${query}”.`}
      {degraded ? ` ${degraded}` : ""}
    </Note>
  );
}

/** Names the domains that could not be searched, so silence is never a zero. */
function describeDegraded(providers: ProviderStates): string | null {
  const down = REPORTED.filter((entity) => providers[entity] === "unavailable");
  const off = REPORTED.filter((entity) => providers[entity] === "not_configured");
  const parts: string[] = [];
  if (down.length > 0) {
    parts.push(`${joinWords(down.map((e) => DEGRADED_LABEL[e]))} search is temporarily unavailable.`);
  }
  if (off.length > 0) {
    parts.push(`${joinWords(off.map((e) => DEGRADED_LABEL[e]))} search is not connected.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="px-3 py-4 text-[13px] leading-snug text-muted-foreground">
      {children}
    </p>
  );
}

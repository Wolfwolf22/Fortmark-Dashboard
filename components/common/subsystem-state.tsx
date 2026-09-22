"use client";

/**
 * What a screen says when its subsystem has no source.
 *
 * One component and one copy table, so the answer to "why is this page
 * empty?" reads the same everywhere and cannot drift into nine different
 * euphemisms. The wording follows the line the listings screen already set —
 * name what is missing, say who can fix it, and never imply the answer is
 * zero.
 *
 * The distinction this enforces is the whole point of the remediation this
 * came from: "you have no messages" is a statement about the brokerage, and
 * "messaging is not connected" is a statement about the deployment. Only the
 * second one is true here.
 */
import { PlugZap } from "lucide-react";
import { useQuery } from "@/lib/data/hooks";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getSubsystemAvailability,
  SubsystemUnavailableError,
  type Subsystem,
  type SubsystemAvailability,
} from "@/lib/data/adapters/subsystems";

/** One sentence each, in FortMark's voice: what is absent, and what follows. */
export const SUBSYSTEM_COPY: Record<Subsystem, { title: string; description: string }> = {
  calendar: {
    title: "Calendar is not connected.",
    description:
      "This deployment has no calendar source, so there are no appointments to show. An administrator needs to connect one.",
  },
  documents: {
    title: "Document storage is not configured.",
    description:
      "This deployment has no document store, so there are no files to show. An administrator needs to configure one.",
  },
  messages: {
    title: "Messaging is not connected.",
    description:
      "This deployment has no messaging source, so there are no conversations to show. An administrator needs to connect one.",
  },
  notifications: {
    title: "Notifications are not connected.",
    description:
      "This deployment has no notification source, so there is nothing to alert you about here yet.",
  },
  market: {
    title: "Market data is not connected.",
    description:
      "This deployment has no market feed, so there is no listing activity to report.",
  },
  team: {
    title: "Team directory is not configured.",
    description:
      "This deployment has no roster source, so there are no colleagues to show. An administrator needs to configure one.",
  },
  brokerage: {
    title: "Brokerage details are not configured.",
    description:
      "This deployment has no brokerage record, so there is nothing to display here yet.",
  },
  integrations: {
    title: "Integrations are not configured.",
    description:
      "This deployment has no integration registry, so no connection status can be reported here.",
  },
  reports: {
    title: "Reports are not available.",
    description:
      "Reporting has no data source in this deployment. Figures will appear once the underlying sources are connected — until then this page states nothing rather than estimating.",
  },
};

/** The subsystem a failed read was about, or null when it failed for another reason. */
export function unavailableSubsystem(error: unknown): Subsystem | null {
  return error instanceof SubsystemUnavailableError ? error.subsystem : null;
}

/**
 * The honest state itself.
 *
 * `compact` drops the vertical padding for places that sit inside a card or a
 * popover rather than owning the page.
 */
export function SubsystemNotConnected({
  subsystem,
  className,
}: {
  subsystem: Subsystem;
  className?: string;
}) {
  const copy = SUBSYSTEM_COPY[subsystem];
  return (
    <EmptyState
      icon={PlugZap}
      title={copy.title}
      description={copy.description}
      className={className}
    />
  );
}

/**
 * Ask the server what this subsystem may show, for a screen that wants to
 * decide before it renders anything rather than after a read fails.
 *
 * Reports needs this: it is five cards over five generated series, and one
 * sentence at the top is a better answer than five identical apologies.
 * Unknown resolves to `not_configured` — a page may show generated figures
 * only when the server has said so, never because the question went
 * unanswered.
 */
export function useSubsystem(subsystem: Subsystem): {
  loading: boolean;
  state: SubsystemAvailability;
} {
  const { data, loading, error } = useQuery(() => getSubsystemAvailability(), [subsystem]);
  return {
    loading: loading && !error,
    state: !error && data ? data[subsystem] : "not_configured",
  };
}

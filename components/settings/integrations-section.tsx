"use client";

/**
 * Integrations — provider rows from getIntegrations(). Nothing is
 * connected yet and the connect flow says so honestly; no fake success
 * states.
 */
import { useState } from "react";
import { SampleNotice } from "@/components/data/sample-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getIntegrations } from "@/lib/data/adapters/settings";
import { useQuery } from "@/lib/data/hooks";
import { IntegrationStatus } from "@/lib/data/types";
import { SectionSkeleton } from "./section-skeleton";

export function IntegrationsSection() {
  const { data, loading } = useQuery(() => getIntegrations(), []);
  // Keep the last-opened integration through the close animation.
  const [dialogIntegration, setDialogIntegration] =
    useState<IntegrationStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function openConnect(integration: IntegrationStatus) {
    setDialogIntegration(integration);
    setDialogOpen(true);
  }

  if (loading || !data) return <SectionSkeleton rows={3} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          Connect the tools this workspace draws from.
        </CardDescription>
        <SampleNotice domain="integrations" className="mt-2" />
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {data.map((integration) => (
            <div
              key={integration.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">{integration.name}</p>
                <p className="text-[13px] text-muted-foreground">
                  {integration.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge variant="muted">
                  {integration.connected ? "Connected" : "Not connected"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openConnect(integration)}
                >
                  Connect
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect {dialogIntegration?.name}</DialogTitle>
            <DialogDescription>
              Connecting {dialogIntegration?.name} requires provider credentials.
              This arrives with the backend integration.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

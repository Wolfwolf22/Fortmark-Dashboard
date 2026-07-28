"use client";

/**
 * Profile — the signed-in user's account details, read from the Clerk
 * session resolved on the server.
 *
 * Name, email and avatar are managed by Clerk, and role is server-controlled,
 * so every field here is read-only. The previous version rendered editable
 * inputs and a "Save changes" button that only mutated local state — it
 * reported success without persisting anything, so it has been replaced
 * rather than left to mislead. Editing moves to a Clerk-authenticated server
 * action when account management lands.
 */
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSessionUser } from "@/components/layout/session-user";
import { portalUrl } from "@/lib/routes";

/** One read-only field, styled to match the Input height it replaces. */
function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <span className="block text-sm font-semibold leading-none">{label}</span>
      <div className="flex h-9 items-center text-sm text-foreground">{value}</div>
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ProfileSection() {
  const user = useSessionUser();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How you appear across the workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <ReadOnlyField label="Name" value={user.name} />
            <ReadOnlyField label="Email" value={user.email ?? "—"} />
            <div className="space-y-2">
              <span className="block text-sm font-semibold leading-none">Role</span>
              <div className="flex h-9 items-center">
                <Badge variant="secondary">{user.role}</Badge>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Roles are managed by your broker.
              </p>
            </div>
          </div>

          <p className="text-[13px] text-muted-foreground">
            Your name, email, and photo come from your FortMark account. Change
            them in account settings and they update here.
          </p>

          <a
            href={portalUrl()}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            Open account settings
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

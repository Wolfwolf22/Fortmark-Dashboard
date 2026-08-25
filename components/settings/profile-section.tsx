"use client";

/**
 * Profile settings — the single place a professional profile is edited.
 *
 * Two distinct records meet on this page, and keeping them visibly separate is
 * the point:
 *
 *   ACCOUNT      name, email, photo and role. Owned by the FortMark account
 *                (Clerk), read-only here, changed in account settings.
 *   PROFESSIONAL everything a FortMark professional publishes — display name,
 *                title, contact details, licence, MLS identity, photo.
 *
 * They were previously conflated: this page showed only the account name while
 * the Home card, the digital card and the top bar showed the professional
 * display name, so changing your display name appeared to "not save" because
 * this page kept reporting the other value.
 *
 * Every editable surface now routes here. The drawer and the digital card link
 * to this page rather than embedding their own copy of the form, so there is
 * one editor, one set of validation messages, and one place a field can be
 * added.
 */
import * as React from "react";
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
import { ProfileEditor } from "@/components/profile/profile-editor";
import type { ProfileDetail } from "@/lib/profile/display";
import { accountUrl, apiPath } from "@/lib/routes";

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

type LoadState =
  | { status: "loading" }
  | { status: "ready"; profile: ProfileDetail | null; imageUploadEnabled: boolean }
  | { status: "error" }
  /** The profile feature is off for this environment — a 404 from the route. */
  | { status: "unavailable" };

export function ProfileSection() {
  const user = useSessionUser();
  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  // Depends on nothing, so it runs once and cannot abort itself — the mistake
  // that left the profile drawer spinning forever.
  React.useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(apiPath("/api/profile"), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        // 404 means the profile feature is disabled here, which is a normal
        // operational state rather than a failure — say so differently.
        if (response.status === 404) {
          if (!cancelled) setState({ status: "unavailable" });
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          profile: ProfileDetail | null;
          imageUploadEnabled?: boolean;
        };
        if (cancelled) return;
        setState({
          status: "ready",
          profile: body.profile ?? null,
          imageUploadEnabled: body.imageUploadEnabled !== false,
        });
      } catch (error) {
        if (cancelled || (error as Error)?.name === "AbortError") return;
        setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Professional profile</CardTitle>
          <CardDescription>
            What you publish on My FortMark and your digital card.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.status === "loading" ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading your profile…
            </p>
          ) : state.status === "unavailable" ? (
            <p className="text-sm text-muted-foreground" role="status">
              Professional profiles are not enabled for this environment.
            </p>
          ) : state.status === "error" ? (
            <p className="text-sm text-muted-foreground" role="status">
              Your profile could not be loaded right now. Everything else in the
              dashboard is unaffected — try again in a moment.
            </p>
          ) : (
            <ProfileEditor
              initial={state.profile}
              imageUploadEnabled={state.imageUploadEnabled}
              onSaved={(profile) =>
                setState({
                  status: "ready",
                  profile,
                  imageUploadEnabled: state.imageUploadEnabled,
                })
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>FortMark account</CardTitle>
          <CardDescription>
            Your sign-in identity. Managed by your account, not by this profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              {/* Labelled "Account name" rather than "Name" on purpose: the
                  professional profile has its own display name above, and two
                  fields both called "Name" showing different values is exactly
                  what made an edit look like it had not saved. */}
              <ReadOnlyField
                label="Account name"
                value={user.name}
                hint="Separate from your preferred display name above."
              />
              <ReadOnlyField label="Account email" value={user.email ?? "—"} />
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

            <a
              href={accountUrl()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              Open account settings
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

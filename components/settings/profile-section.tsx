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
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { accountUrl, apiPath, ROUTES } from "@/lib/routes";
import { titleLabel } from "@/lib/profile/titles";
import { mlsBoardLabel, mlsStatusLabel } from "@/lib/profile/mls";
import { formatPhoneDisplay } from "@/lib/profile/links";

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

/** One read-only professional field. Renders nothing when unset. */
function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function ProfileSection() {
  const user = useSessionUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  /**
   * Edit is a mode, and arriving from an "Edit profile" button opens it.
   *
   * Home's card and the digital card both link here with `edit=1`, so those
   * buttons do what they say instead of landing on a read-only page. Reaching
   * Settings through the nav shows the record first, which is the right
   * default for a page you may have opened to read rather than change.
   */
  const [editing, setEditing] = React.useState(
    () => searchParams.get("edit") === "1"
  );

  /**
   * Leave edit mode after a save, and drop the `edit` flag from the URL.
   *
   * Without clearing it, the form stayed open on top of the record it had
   * just written, and a refresh would reopen it — so a finished save kept
   * looking unfinished.
   */
  const finishEditing = React.useCallback(() => {
    setEditing(false);
    if (searchParams.get("edit")) {
      router.replace(`${ROUTES.settings}?tab=profile`, { scroll: false });
    }
  }, [router, searchParams]);

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
          ) : editing ? (
            <ProfileEditor
              initial={state.profile}
              imageUploadEnabled={state.imageUploadEnabled}
              onSaved={(profile) => {
                setState({
                  status: "ready",
                  profile,
                  imageUploadEnabled: state.imageUploadEnabled,
                });
                finishEditing();
              }}
            />
          ) : (
            <ProfileRecord
              profile={state.profile}
              onEdit={() => setEditing(true)}
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

/**
 * The collapsed record.
 *
 * Shows what the profile HAS. Empty fields are omitted rather than listed as
 * blanks — a column of "Not added" rows is what makes a finished profile read
 * as an unfinished form.
 *
 * Values are rendered through the same catalogues the public surfaces use, so
 * a stored key like `broker_associate` never reaches a human here either.
 */
function ProfileRecord({
  profile,
  onEdit,
}: {
  profile: ProfileDetail | null;
  onEdit: () => void;
}) {
  const licence =
    [profile?.licenseState, profile?.licenseNumber].filter(Boolean).join(" ") || null;
  const mlsId = profile?.mlsAgentId ?? null;

  return (
    <div className="space-y-5">
      {typeof profile?.completion === "number" && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">Profile completion</span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {profile.completion}%
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={profile.completion}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Profile completion"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${profile.completion}%` }}
            />
          </div>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        <Detail label="Preferred display name" value={profile?.preferredDisplayName ?? null} />
        <Detail label="Professional title" value={titleLabel(profile?.professionalTitle)} />
        <Detail label="Brokerage" value={profile?.brokerageOffice ?? null} />
        <Detail label="Location" value={profile?.locationDisplay ?? null} />
        <Detail label="Phone" value={formatPhoneDisplay(profile?.phoneE164)} />
        <Detail label="Alternative email" value={profile?.businessEmail ?? null} />
        <Detail label="Licence" value={licence} />
        <Detail label="NRDS ID" value={profile?.nrdsNumber ?? null} />
        <Detail label="MLS agent ID" value={mlsId} />
        <Detail label="MLS or board" value={mlsBoardLabel(profile?.mlsOrganization)} />
      </dl>

      {profile?.biography && (
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Biography
          </dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
            {profile.biography}
          </dd>
        </div>
      )}

      {mlsId && (
        <p className="text-[12px] text-muted-foreground">
          MLS identity is self-reported —{" "}
          <span className="font-medium text-foreground">
            {mlsStatusLabel(profile?.mlsVerificationStatus ?? "unverified")}
          </span>
          .
        </p>
      )}

      <Button className="h-10 w-full min-w-0 px-3 text-[13px] sm:w-auto" onClick={onEdit}>
        <Pencil aria-hidden />
        <span className="truncate">Edit profile</span>
      </Button>
    </div>
  );
}

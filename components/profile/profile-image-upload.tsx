"use client";

/**
 * The shared profile photo control.
 *
 * Used by both onboarding step 1 and the settings editor, so the size rules,
 * the accepted formats, the error wording and the preview lifecycle cannot
 * drift between them.
 *
 * Nothing here writes to a global store: the File and its object URL live in
 * this component's state and are revoked when replaced or unmounted. Image
 * bytes must never become ambient client state.
 *
 * Client-side checks are courtesy, not security — they exist so a user learns
 * a 12 MB photo is too large before waiting for the upload. The server
 * re-checks size, declared type and the actual bytes, and its answer is the
 * only one that counts.
 */
import * as React from "react";
import { Camera, Loader2, Upload } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiPath } from "@/lib/routes";
import { initials } from "@/lib/utils";

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";
const GENERIC_ERROR = "Choose a JPEG, PNG, or WebP image under 4 MB.";

/**
 * Shown when the server reports the upload route does not exist.
 *
 * A 404 here means PROFILE_IMAGE_UPLOAD_ENABLED is off for this environment,
 * which is a normal operational state — the Blob token is scoped to Production
 * and Preview together, so the flag is what actually keeps uploads off. It is
 * NOT a problem with the file the user chose, and saying "choose a JPEG, PNG,
 * or WebP under 4 MB" would send them off resizing a photo that was fine.
 *
 * The flag is deliberately not passed in as a prop. The drawer's editor is
 * reached through a client fetch, so a prop would be a second source of truth
 * that can disagree with the server; the 404 comes from the same check that
 * would refuse the write.
 */
const UNAVAILABLE_ERROR = "Photo uploads are turned off for this environment.";

export interface ProfileImageUploadProps {
  /** Current active image, for the initial preview. */
  currentUrl: string | null;
  /** Used for initials when there is no image at all. */
  displayName: string;
  /** Called with the new URL after the SERVER confirmed activation. */
  onUploaded?: (url: string) => void;
  disabled?: boolean;
}

export function ProfileImageUpload({
  currentUrl,
  displayName,
  onUploaded,
  disabled,
}: ProfileImageUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [activeUrl, setActiveUrl] = React.useState<string | null>(currentUrl);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Latches once the server answers 404. The flag cannot change mid-session, so
  // re-offering the control would only produce the same refusal again.
  const [unavailable, setUnavailable] = React.useState(false);
  const objectUrlRef = React.useRef<string | null>(null);

  /** Replace the preview, revoking whatever it displaced. */
  const setPreview = React.useCallback((file: File | null) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreviewUrl(url);
  }, []);

  // Revoke on unmount too: leaving the wizard mid-upload would otherwise hold
  // the blob for the lifetime of the document.
  React.useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function onSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    // Allow re-selecting the same file after a failure.
    event.target.value = "";
    if (!file) return;

    setError(null);

    if (file.size > MAX_BYTES) {
      setError(GENERIC_ERROR);
      return;
    }
    if (!ACCEPT.split(",").includes(file.type)) {
      setError(GENERIC_ERROR);
      return;
    }

    setPreview(file);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(apiPath("/api/profile/image"), { method: "POST", body });

      if (!res.ok) {
        // Drop the preview so the control keeps showing the image that is
        // actually live. A failed upload must not look like it worked.
        setPreview(null);

        // The feature is off for this environment. Never blame the file.
        if (res.status === 404) {
          setUnavailable(true);
          setError(UNAVAILABLE_ERROR);
          return;
        }
        // 401/403/503 are not the file's fault either — only a 400 carries the
        // validation contract, so only a 400 may report a format problem.
        if (res.status !== 400) {
          setError("That upload did not finish. Please try again.");
          return;
        }

        const detail = (await res.json().catch(() => null)) as
          | { fieldErrors?: { profileImage?: string[] } }
          | null;
        setError(detail?.fieldErrors?.profileImage?.[0] ?? GENERIC_ERROR);
        return;
      }

      const data = (await res.json()) as { image?: { url?: string } };
      const url = data.image?.url;
      if (url) {
        setActiveUrl(url);
        setPreview(null);
        onUploaded?.(url);
      }
    } catch {
      setError("That upload did not finish. Please try again.");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  }

  const shown = previewUrl ?? activeUrl;
  const errorId = error ? "profile-image-error" : undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor="profileImage">Profile photo</Label>

      <div className="flex items-center gap-4">
        <Avatar className="h-[76px] w-[76px] shrink-0 rounded-panel">
          {shown && <AvatarImage src={shown} alt="" className="object-cover" />}
          <AvatarFallback className="rounded-panel text-lg">
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 space-y-1.5">
          {/* The real control. Visually hidden rather than `display: none`, so
              it stays reachable by keyboard and by assistive technology. */}
          <input
            ref={inputRef}
            id="profileImage"
            name="profileImage"
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={onSelect}
            disabled={disabled || uploading || unavailable}
            aria-describedby={[errorId, "profile-image-hint"].filter(Boolean).join(" ")}
            aria-invalid={error ? true : undefined}
          />
          <Button
            type="button"
            variant="outline"
            className="h-10 min-w-0 border-foreground/45 px-3 text-[13px]"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || uploading || unavailable}
          >
            {uploading ? <Loader2 className="animate-spin" /> : activeUrl ? <Camera /> : <Upload />}
            <span className="truncate">
              {uploading ? "Uploading" : activeUrl ? "Replace photo" : "Add photo"}
            </span>
          </Button>
          <p id="profile-image-hint" className="text-[12px] text-foreground/55">
            {unavailable
              ? "Your existing photo is unaffected."
              : "JPEG, PNG or WebP, up to 4 MB."}
          </p>
        </div>
      </div>

      {/* Destructive styling only when the user can act on it. A switched-off
          feature is not their mistake, so it reads as information. */}
      {error && (
        <p
          id={errorId}
          className={
            unavailable
              ? "text-[12px] text-foreground/70"
              : "text-[12px] font-medium text-destructive"
          }
        >
          {error}
        </p>
      )}

      {/* Announced only once the server confirmed the replacement. */}
      <p aria-live="polite" className="sr-only">
        {uploading ? "Uploading your photo" : ""}
      </p>
    </div>
  );
}

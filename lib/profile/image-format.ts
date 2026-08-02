/**
 * Actual image format detection, from the bytes.
 *
 * The browser's `Content-Type` and the filename extension are both attacker
 * controlled: a caller can label anything `image/jpeg` and name it `.jpg`.
 * Neither says what the file IS, so neither is trusted here — the signature is
 * read from the first bytes and everything else is checked against it.
 *
 * Implemented directly rather than pulling in a format-sniffing dependency:
 * three signatures are a few lines, and a narrow allowlist of exactly the
 * formats we accept is easier to audit than a library that recognises a
 * hundred types we would then have to exclude.
 */

/** The only formats a profile photo may be. */
export type AllowedImageFormat = "jpeg" | "png" | "webp";

export const ALLOWED_IMAGE_MIME: Record<AllowedImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Extension used for the stored object, derived from the DETECTED format. */
export const IMAGE_EXTENSION: Record<AllowedImageFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

/**
 * 4 MB.
 *
 * Vercel Functions cap the request body at 4.5 MB, so the application limit
 * has to leave room for multipart framing and headers. A profile photo has no
 * business approaching this.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Detect the format, or null when it is not one we accept.
 *
 * Null covers "unknown" and "known but not allowed" alike — SVG, GIF, PDF and
 * anything else all land in the same place, because the answer to every one of
 * them is the same refusal. There is no branch that could accidentally admit a
 * format by recognising it.
 */
export function detectImageFormat(bytes: Uint8Array): AllowedImageFormat | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";

  // WebP: "RIFF" .... "WEBP" — both halves are required. Checking only "RIFF"
  // would accept WAV and AVI, which share the container.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }

  return null;
}

export type ImageRejection =
  | "missing"
  | "too_large"
  | "unsupported_mime"
  | "unrecognised_format"
  | "mime_mismatch";

export type ImageCheck =
  | { ok: true; format: AllowedImageFormat; extension: string }
  | { ok: false; reason: ImageRejection };

/**
 * Full check: size, declared type, actual bytes, and agreement between them.
 *
 * The order matters. Size is cheapest and is checked first. The declared MIME
 * is checked before the bytes so a plainly unsupported upload is refused
 * without inspection. The two are then compared, so a PNG announced as a JPEG
 * is refused even though both formats are individually allowed — a file whose
 * label disagrees with its content is not something to store under either
 * name.
 */
export function checkProfileImage(input: {
  size: number;
  declaredType: string | null | undefined;
  bytes: Uint8Array;
}): ImageCheck {
  if (input.size <= 0 || input.bytes.length === 0) return { ok: false, reason: "missing" };
  if (input.size > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };

  const declared = (input.declaredType ?? "").split(";")[0].trim().toLowerCase();
  const allowedMimes = Object.values(ALLOWED_IMAGE_MIME) as string[];
  if (!allowedMimes.includes(declared)) return { ok: false, reason: "unsupported_mime" };

  const format = detectImageFormat(input.bytes);
  if (!format) return { ok: false, reason: "unrecognised_format" };

  if (ALLOWED_IMAGE_MIME[format] !== declared) return { ok: false, reason: "mime_mismatch" };

  return { ok: true, format, extension: IMAGE_EXTENSION[format] };
}

/** One user-facing message for every rejection. Never leaks internals. */
export const IMAGE_ERROR_MESSAGE = "Choose a JPEG, PNG, or WebP image under 4 MB.";

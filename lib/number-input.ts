/** Display separators never become stored digits, identifiers, or a currency conversion. */
export function numericDraft(value: string): string | null {
  const pasted = value.trim();
  if (!/^-?\$?(?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d*)?%?$/.test(pasted) || pasted.includes("$") && pasted.includes("%")) return null;
  const clean = pasted.replace(/[,$%]/g, "");
  const normalized = clean.replace(/^(-?)0+(?=\d)/, "$1");
  return normalized.startsWith(".") ? `0${normalized}` : normalized.startsWith("-.") ? normalized.replace("-.", "-0.") : normalized;
}

export function groupNumericDraft(value: string): string {
  const raw = numericDraft(value);
  if (raw === null) return value;
  const [whole, fraction] = raw.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
}

export function numericCaret(display: string, meaningfulCharacters: number): number {
  if (meaningfulCharacters <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < display.length; index++) {
    if (display[index] !== ",") seen++;
    if (seen >= meaningfulCharacters) return index + 1;
  }
  return display.length;
}

export function numericConstraintMessage(raw: string, options: { min?: string | number; max?: string | number; step?: string | number }): string {
  if (raw === "") return ""; // The input's native required constraint handles an empty value.
  const value = Number(raw);
  if (!Number.isFinite(value) || raw === "-" || raw.endsWith(".")) return "Enter a complete number.";
  const min = options.min === undefined ? null : Number(options.min), max = options.max === undefined ? null : Number(options.max);
  if (min !== null && Number.isFinite(min) && value < min) return `Enter ${groupNumericDraft(String(min))} or more.`;
  if (max !== null && Number.isFinite(max) && value > max) return `Enter ${groupNumericDraft(String(max))} or less.`;
  const step = options.step === undefined || options.step === "any" ? null : Number(options.step);
  if (step !== null && Number.isFinite(step) && step > 0) {
    const units = (value - (min ?? 0)) / step;
    if (Math.abs(units - Math.round(units)) > 1e-7) return `Use increments of ${step}.`;
  }
  return "";
}

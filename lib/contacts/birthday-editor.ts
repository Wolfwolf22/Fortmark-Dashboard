/** A birthday draft and the saved version it was opened against. */
import type { Birthday } from "./birthday.ts";

export interface BirthdayEditorSnapshot {
  value: Birthday | null;
  revision?: string;
}
export function birthdayEditorSnapshot(value: Birthday | null | undefined, revision?: string): BirthdayEditorSnapshot {
  return { value: value ? { month: value.month, day: value.day } : null, revision };
}
export function birthdayEditorChanged(opening: BirthdayEditorSnapshot, latest: BirthdayEditorSnapshot): boolean {
  if (opening.revision && latest.revision && Date.parse(latest.revision) < Date.parse(opening.revision)) return false;
  return opening.revision !== latest.revision || opening.value?.month !== latest.value?.month || opening.value?.day !== latest.value?.day;
}
/** No automatic rebasing: the caller must supply the person's explicit choice. */
export function reviewBirthdayEditor(draft: Birthday | null, latest: BirthdayEditorSnapshot, choice: "saved" | "draft") {
  return { baseline: birthdayEditorSnapshot(latest.value, latest.revision), value: choice === "saved" ? latest.value : draft };
}

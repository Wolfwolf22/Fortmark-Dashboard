import assert from "node:assert/strict";
import { groupNumericDraft, numericCaret, numericConstraintMessage, numericDraft } from "../lib/number-input.ts";
import { dollarsToCents } from "../lib/transactions/money.ts";
let checks = 0;
function check(condition: unknown, message: string) { assert.ok(condition, message); checks++; }
for (const [raw, display] of [["1000", "1,000"], ["1250000", "1,250,000"], ["1250000.25", "1,250,000.25"], ["-12500.50", "-12,500.50"], ["0", "0"], ["0.05", "0.05"], ["12.", "12."], ["", ""]]) {
  check(groupNumericDraft(raw) === display, `Group ${raw}`);
  check(numericDraft(display) === raw, `Ungroup ${display} without changing decimal digits`);
}
check(numericDraft("00000") === "0", "Leading zeros do not become an apparent large amount");
check(numericDraft("$1,250,000.25") === "1250000.25", "Pasted currency keeps cents");
check(numericDraft("1e5") === null, "Scientific notation is refused rather than silently becoming fifteen");
check(numericDraft("1.2.3") === null && numericDraft("1-2") === null, "Malformed amounts cannot be silently stored");
for (const malformed of ["1,,2", "1,5", "1$2", "1%2", "$12%", "1 2", "1,000,00"]) check(numericDraft(malformed) === null, `Refuse malformed pasted amount ${malformed}`);
check(numericDraft("  -$1,250.50  ") === "-1250.50" && numericDraft("12.5%") === "12.5", "Boundary currency and percentage symbols retain their actual digits");
check(numericDraft(".25") === "0.25", "A fractional amount gains a leading zero");
check(numericCaret("1,250,000.25", 4) === 5, "Caret tracks meaningful digits across a separator");
check(numericCaret("1,250", 0) === 0 && numericCaret("1,250", 99) === 5, "Caret remains bounded");
check(numericConstraintMessage("1001", { max: 1000 }).includes("1,000"), "Text presentation retains numeric maximum validation");
check(numericConstraintMessage("-1", { min: 0 }) !== "", "Numeric minimum remains enforced");
check(numericConstraintMessage("1.5", { step: 1 }) !== "", "Integer fields still reject fractions");
check(numericConstraintMessage("1.25", { step: ".25" }) === "", "Decimal step is calculated without separator artifacts");
check(numericConstraintMessage("", {}) === "" && numericConstraintMessage("-", {}) !== "", "Required and incomplete drafts retain distinct behavior");
check(dollarsToCents(numericDraft("1,250,000.25")!) === 125000025, "Grouped money round-trips through actual stored cents parsing");
console.log(`${checks}/${checks} grouped numeric input checks passed`);

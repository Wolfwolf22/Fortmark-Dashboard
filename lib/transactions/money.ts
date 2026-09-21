/**
 * Commission arithmetic, in integers.
 *
 * Every amount is integer cents and every rate is integer basis points
 * (1 bp = 0.01%). Nothing here touches a float on a stored value: the one
 * place a division happens is the final `Math.round` of a product of
 * integers, which is exact for every figure a brokerage will meet.
 *
 * These are PROJECTIONS from the deal's stated terms. What has actually been
 * paid lives on the row (`commission_paid_cents`) and is never derived.
 *
 * Pure, dependency-free, importable by tests directly.
 */

/** Basis points in a whole. 10 000 bps = 100%. */
export const BPS_PER_WHOLE = 10_000;

export interface CommissionTerms {
  contractPriceCents: number | null;
  /** Percentage terms, in basis points of the contract price. */
  commissionRateBps: number | null;
  /** Or flat terms. When both are present the flat figure wins — it is the
   *  more specific statement of the agreement. */
  commissionFlatCents: number | null;
  /** The agent's share of the brokerage gross, in basis points. */
  agentSplitBps: number | null;
  transactionFeeCents: number | null;
  /** A referral owed out of the gross, in basis points of the gross. */
  referralFeeBps: number | null;
}

export interface CommissionProjection {
  /** Gross commission to the brokerage before any deduction. */
  grossCents: number;
  /** Paid out to a referring party from the gross. */
  referralCents: number;
  /** Gross after referral: what the brokerage actually has to split. */
  netToBrokerageCents: number;
  /** The agent's share of the net, before the transaction fee. */
  agentShareCents: number;
  transactionFeeCents: number;
  /** What the agent is projected to receive. Never below zero. */
  agentNetCents: number;
  /** What the brokerage retains. */
  brokerageRetainedCents: number;
  /** Which terms produced the gross, so the UI can say so. */
  basis: "flat" | "rate" | "none";
}

/** A non-negative integer, or null. Rejects NaN, floats and negatives. */
function whole(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/** `amount × bps / 10 000`, rounded to the cent. */
export function applyBps(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / BPS_PER_WHOLE);
}

/**
 * Project the commission from the deal's terms.
 *
 * Missing terms produce zeros, not guesses: a deal with no rate and no flat
 * figure projects a gross of 0 with `basis: "none"`, and the UI shows that
 * nothing has been entered rather than a number.
 */
export function projectCommission(terms: CommissionTerms): CommissionProjection {
  const price = whole(terms.contractPriceCents);
  const flat = whole(terms.commissionFlatCents);
  const rate = whole(terms.commissionRateBps);
  const split = whole(terms.agentSplitBps);
  const fee = whole(terms.transactionFeeCents) ?? 0;
  const referralBps = whole(terms.referralFeeBps) ?? 0;

  let gross = 0;
  let basis: CommissionProjection["basis"] = "none";
  if (flat !== null) {
    gross = flat;
    basis = "flat";
  } else if (rate !== null && price !== null) {
    gross = applyBps(price, rate);
    basis = "rate";
  }

  const referral = applyBps(gross, Math.min(referralBps, BPS_PER_WHOLE));
  const net = gross - referral;
  // No split entered means no projection of the agent's share — not 100%,
  // not 0%: the figure is unknown, and the UI is told so through `split`.
  const agentShare = split === null ? 0 : applyBps(net, Math.min(split, BPS_PER_WHOLE));
  const agentNet = Math.max(0, agentShare - fee);
  const retained = net - agentShare + Math.min(fee, agentShare);

  return {
    grossCents: gross,
    referralCents: referral,
    netToBrokerageCents: net,
    agentShareCents: agentShare,
    transactionFeeCents: fee,
    agentNetCents: agentNet,
    brokerageRetainedCents: retained,
    basis,
  };
}

/** Dollars → cents, for input parsing only. Never used on stored values. */
export function dollarsToCents(input: string | number): number | null {
  const n = typeof input === "number" ? input : Number(String(input).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Percent (e.g. 2.5) → basis points (250), for input parsing only. */
export function percentToBps(input: string | number): number | null {
  const n = typeof input === "number" ? input : Number(String(input).replace(/[%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/** Cents → whole dollars, for display through the existing formatters. */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Mock assistant responses for the streaming stub. Picks a realistic,
 * markdown-rich reply shaped by the prompt so the thread UI can be exercised
 * end to end. Deleted wholesale when the real provider connects.
 */

const PRICING_REPLY = `Here is a first pass at the pricing picture.

## Comp set summary

| Address | Status | Close price | $/sqft | DOM |
| --- | --- | --- | --- | --- |
| 2416 NE 26th St | Closed | $1,285,000 | $612 | 24 |
| 517 Bayview Dr | Closed | $1,190,000 | $588 | 41 |
| 3308 NE 16th Ter | Pending | $1,349,000 (ask) | $641 | 12 |

The trailing 90-day median for the segment sits near **$605/sqft** with a
list-to-sale ratio of 97.2%.

## What this suggests

1. Position the list price inside the $1.25M–$1.32M band.
2. The pending comp at $641/sqft is the ceiling test — watch how it records.
3. Days on market under 30 supports holding closer to the top of the band.

I can turn this into a documented pricing plan with the adjustment grid if you
want the full write-up.`;

const FOLLOWUP_REPLY = `Here is a draft you can send as-is or edit.

> Good afternoon — following up on Saturday's showing at Bayview Dr.
> The sellers have reviewed the feedback and are prepared to discuss terms.
> If your clients remain interested, I can hold time Thursday to walk through
> a written offer structure. Either way, I'll keep you posted on activity.

Two notes on the approach:

- It states the next step and a time, without pressure.
- It commits you to nothing while keeping the record in writing.

Want a shorter text-message version as well?`;

const PIPELINE_REPLY = `Looking across the active pipeline, three items deserve attention this week.

### Where the risk sits

1. **Inspection deadlines** — two transactions have inspection periods ending
   within five days. Both need the reports logged and any credit requests in
   writing before the window closes.
2. **Financing contingency** — one file shows an appraisal received but no
   loan-commitment date recorded. Worth a call to the lender today.
3. **Expiring listings** — three listing agreements expire inside two weeks.
   Renewal conversations go better before the expiration date, not after.

### Suggested order of work

| Priority | Item | Owner |
| --- | --- | --- |
| 1 | Log inspection reports, send credit requests | Coordinator |
| 2 | Confirm loan commitment date | Listing agent |
| 3 | Schedule renewal conversations | Broker |

The numbers behind this are in the Transactions and Documents views. I can
draft the renewal outreach if that helps.`;

const CODE_REPLY = `That calculation is straightforward to script. Here is a small example:

\`\`\`ts
// Net proceeds estimate at a given contract price
function netProceeds(contractPrice: number) {
  const commission = contractPrice * 0.06;     // both sides
  const titleAndClosing = contractPrice * 0.015;
  const docStamps = contractPrice * 0.007;     // FL deed stamps
  return contractPrice - commission - titleAndClosing - docStamps;
}

console.log(netProceeds(1_250_000)); // 1,146,250
\`\`\`

Key assumptions worth confirming before you put this in front of a client:

- Commission structure on the listing agreement
- Whether the seller carries any payoff or lien amounts
- Prorated taxes at the closing date

Send me the contract price and payoff figures and I'll run the exact sheet.`;

const DEFAULT_REPLY = `Understood. Here is how I would approach it.

**What I can work from today**

- Active listings, transactions, and lead records in this workspace
- The market activity feed for the neighborhoods you cover
- Document status across open files

**A reasonable next step**

Tell me the property, client, or deal you have in mind and what decision you
are trying to make. I will lay out the evidence first, then the
recommendation — in that order.

Nothing here goes to a client without your review.`;

export function mockReplyFor(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/(price|pricing|list at|worth|comp|cma|value)/.test(p)) return PRICING_REPLY;
  if (/(draft|email|follow.?up|message|write|text)/.test(p)) return FOLLOWUP_REPLY;
  if (/(pipeline|risk|deadline|week|attention|status|review)/.test(p)) return PIPELINE_REPLY;
  if (/(code|script|calculate|formula|net|proceeds)/.test(p)) return CODE_REPLY;
  return DEFAULT_REPLY;
}

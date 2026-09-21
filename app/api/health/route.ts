import { NextResponse } from "next/server";
import { contactsSource } from "@/lib/contacts/http";
import { transactionsSource } from "@/lib/transactions/http";
import { listingAvailability } from "@/lib/mls/config";
import { sampleDashboardEnabled } from "@/lib/flags";
import { assistantAvailability } from "@/lib/ai/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which source each domain is actually serving, right now, in this deployment.
 *
 * It exists because "the environment variable is set" is not proof. A flag can
 * be scoped to the wrong branch, a deployment can predate the change, a
 * dependency flag can quietly veto it — and every one of those failures looks
 * identical from the outside until something states what the running process
 * resolved. This is that statement, taken from the same helpers the routes
 * themselves call, so it cannot drift from their behaviour.
 *
 * Unauthenticated by design: an operator must be able to ask a deployment
 * whether it is serving real records *before* signing into it, and a readiness
 * probe that needs a session is not a readiness probe.
 *
 * It therefore says the absolute minimum. Four coarse labels, no counts, no
 * record, no variable name, no variable value, no database identity, no error
 * text. Nothing here narrows an attack: it reports the same configuration an
 * authenticated user could infer in one click, and withholding it buys secrecy
 * only against the operator.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      /**
       * Which revision is answering.
       *
       * Every phase of this project ends by proving a claim against the
       * running deployment, and that is impossible without knowing which
       * build is serving: an alias follows the latest *successful* deployment,
       * so a failed build is indistinguishable from an unchanged one from the
       * outside. Seven characters of the commit, supplied by the platform.
       * The repository is private, so it identifies a build to its operator
       * and nothing to anyone else.
       */
      revision: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      sources: {
        transactions: transactionsSource(),
        contacts: contactsSource(),
        listings: listingAvailability(),
        /** Whether Home may show the generated sample brokerage. */
        homeMetrics: sampleDashboardEnabled() ? "sample-permitted" : "real-only",
        /** Whether the assistant has a model behind it. It has no other mode. */
        assistant: assistantAvailability(),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

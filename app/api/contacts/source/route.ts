import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/auth/require-caller";
import { contactsSource, NO_STORE } from "@/lib/contacts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which source the leads screen is on. The server owns the decision. */
export async function GET() {
  const caller = await requireCaller();
  if (!caller.ok) return caller.response;
  return NextResponse.json({ source: contactsSource() }, { headers: NO_STORE });
}

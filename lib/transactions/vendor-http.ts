import "server-only";
import { NextResponse } from "next/server";
import { failure, NO_STORE } from "./http.ts";
import type { VendorFailure } from "./vendor-service.ts";
export function vendorFailure(reason: VendorFailure): NextResponse {
  return reason === "vendor_unavailable" ? NextResponse.json({ error: reason }, { status: 409, headers: NO_STORE }) : failure(reason);
}

"use client";

/**
 * The signed-in user's MLS identity, as FortMark resolved it from their
 * professional licence. Read-only: nobody types an MLS id or an office here.
 *
 * States come from the server (`/api/profile/mls`). "Not found" is phrased as
 * an MLS fact, never as a verdict on the licence.
 */
import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiPath } from "@/lib/routes";
import {
  MLS_STATE_DETAIL,
  MLS_STATE_LABEL,
  type MlsIdentityView,
} from "@/lib/mls-identity/rules";

type Load = { status: "loading" } | { status: "ready"; view: MlsIdentityView } | { status: "error" };

async function call(method: "GET" | "POST"): Promise<MlsIdentityView> {
  const r = await fetch(apiPath("/api/profile/mls"), {
    method,
    headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
    body: method === "POST" ? "{}" : undefined,
  });
  if (!r.ok) throw new Error(String(r.status));
  const body = (await r.json()) as { identity: MlsIdentityView };
  return body.identity;
}

export function MlsIdentityStatus({ refreshKey = "", compact = false }: { refreshKey?: string | number; compact?: boolean }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    call("GET")
      .then((view) => !cancelled && setLoad({ status: "ready", view }))
      .catch(() => !cancelled && setLoad({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function checkAgain() {
    setChecking(true);
    try {
      setLoad({ status: "ready", view: await call("POST") });
    } catch {
      setLoad({ status: "error" });
    } finally {
      setChecking(false);
    }
  }

  const view = load.status === "ready" ? load.view : null;
  const label =
    load.status === "loading"
      ? "Checking…"
      : load.status === "error"
        ? "Status unavailable"
        : view!.linked && view!.officeName
          ? `${MLS_STATE_LABEL.linked} · ${view!.officeName}`
          : MLS_STATE_LABEL[view!.state];
  const detail =
    load.status === "error" ? "The MLS status could not be loaded. Your profile is unaffected." : view ? MLS_STATE_DETAIL[view.state] : null;
  const canRetry = view && view.state !== "linked" && view.state !== "no_license";

  return (
    <div className="min-w-0" data-testid="mls-identity-status">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">MLS</dt>
      <dd className="mt-0.5 text-sm font-medium text-foreground" role="status">
        {label}
      </dd>
      {!compact && detail && <p className="mt-0.5 text-[12px] text-muted-foreground">{detail}</p>}
      {view?.memberMlsId && view.linked && (
        <p className="mt-0.5 text-[12px] text-muted-foreground">MLS member id {view.memberMlsId}</p>
      )}
      {canRetry && (
        <Button variant="ghost" size="sm" className="mt-1 h-8 px-2 text-[12px]" onClick={checkAgain} disabled={checking}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {checking ? "Checking…" : "Check again"}
        </Button>
      )}
    </div>
  );
}

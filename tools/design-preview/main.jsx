import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { HomeHero } from "@/components/home/home-hero";
import { HomeMetricsProvider } from "@/components/home/metrics-provider";
import { BentoGrid } from "@/components/home/bento-grid";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { PreviewNavigation, usePathname, Link as PreviewLink } from "./next-stubs";
import { installPreviewTransport } from "./fixtures.mjs";
import { connectLayoutStorage } from "@/lib/stores/layout";
import { pageTitleFor } from "@/components/layout/nav-items";
import ListingsPage from "@/app/(app)/listings/page";
import ListingDetailPage from "@/app/(app)/listings/[id]/page";
import TransactionsPage from "@/app/(app)/transactions/page";
import ContactsPage from "@/app/(app)/contacts/page";
import PropertyListsPage from "@/app/(app)/property-lists/page";
import { PREVIEW_WRITE_EVENT } from "./read-only.mjs";
import { sampleImportCsv } from "./import-merge-fixtures.mjs";

installPreviewTransport();
// In-memory only: dragging in this review never touches account storage.
const values = new Map();
connectLayoutStorage({ getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) });
const user = { name: "Sample Agent", email: null, imageUrl: null, role: "Admin" };
const profile = { editable: true, display: { displayName: "Sample Agent", roleLabel: "Admin", licenseLabel: null, imageUrl: null, completion: 100 } };

function DesignSystem() {
  return <section className="space-y-8" aria-label="Design foundations">
    <div><p className="text-micro">FortMark workspace</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Design foundations</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">The same typography, surfaces and controls used throughout the dashboard. These examples use no live data.</p></div>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Clear actions</CardTitle><CardDescription>One primary action, with quiet supporting controls.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-3"><Button>Save changes</Button><Button variant="outline">View details</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Cancel</Button><Button disabled>Unavailable</Button></CardContent></Card>
      <Card><CardHeader><CardTitle>Readable hierarchy</CardTitle><CardDescription>Archivo, disciplined spacing and clear secondary text.</CardDescription></CardHeader><CardContent><p className="text-micro">Brokerage overview</p><p className="mt-3 text-3xl font-semibold tracking-tight">Your business, clearly.</p><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Supporting information stays readable in both light and dark themes.</p></CardContent></Card>
      <Card><CardHeader><CardTitle>Form controls</CardTitle><CardDescription>Visible boundaries and keyboard focus.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label htmlFor="preview-name">Display name</Label><Input id="preview-name" defaultValue="Sample Agent" /></div><div className="space-y-2"><Label htmlFor="preview-email">Email address</Label><Input id="preview-email" type="email" placeholder="name@example.com" /></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Small, purposeful status</CardTitle><CardDescription>Restrained color identifies state without taking over the interface.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-start gap-3"><StatusPill tone="good">Active</StatusPill><StatusPill tone="warn">Due soon</StatusPill><StatusPill tone="bad">Overdue</StatusPill><StatusPill tone="neutral">Not set</StatusPill><Badge variant="outline">Listing side</Badge></CardContent></Card>
    </div>
  </section>;
}

function Content() {
  const route = usePathname();
  if (route === "/") return <HomeMetricsProvider><HomeHero greetingName="Sample" roleLabel="Admin" /><BentoGrid /></HomeMetricsProvider>;
  if (route === "/listings") return <ListingsPage />;
  if (route.startsWith("/listings/")) return <ListingDetailPage />;
  if (route === "/transactions") return <TransactionsPage />;
  if (route === "/contacts") return <ContactsPage />;
  if (route === "/property-lists") return <PropertyListsPage />;
  if (route === "/settings") return <DesignSystem />;
  return <Card className="p-8"><p className="text-micro">Design preview</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">{pageTitleFor(route)}</h2><p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">This preview covers the shared identity and Home layout. This destination is shown to verify navigation, active states and shared styling. Production workflows and records are not connected.</p><Button className="mt-6" onClick={() => window.history.back()}>Go back</Button></Card>;
}

function PreviewControls() {
  const route = usePathname();
  const scenario = new URLSearchParams(window.location.search).get("scenario") || "records";
  const interactive = scenario === "interactive";
  const [writeBlocked, setWriteBlocked] = React.useState(false);
  React.useEffect(() => {
    const blocked = () => setWriteBlocked(true);
    window.addEventListener(PREVIEW_WRITE_EVENT, blocked);
    return () => window.removeEventListener(PREVIEW_WRITE_EVENT, blocked);
  }, []);
  return <>
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 border-b border-border bg-card px-4 py-2 text-center text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{interactive ? "Interactive samples" : "Design preview"}</span><span aria-hidden>·</span>
      <span>{interactive ? "Changes stay in memory. Reload resets. No live services." : "Read-only sample data. No live accounts or services."}</span>
      <PreviewLink href="/settings" className="ml-1 font-semibold text-foreground underline underline-offset-4">View foundations</PreviewLink>
      {route === "/contacts" && <PreviewLink href="/contacts?open=sample-long-history" className="font-semibold text-foreground underline underline-offset-4">Long history case</PreviewLink>}
      {route === "/contacts" && <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(sampleImportCsv)}`} download="fortmark-synthetic-contacts.csv" className="font-semibold text-foreground underline underline-offset-4">Sample CSV</a>}
      {interactive && <button type="button" className="font-semibold text-foreground underline underline-offset-4" onClick={() => window.location.reload()}>Reset samples</button>}
      {["/transactions", "/contacts", "/property-lists"].includes(route) && <label className="ml-2 flex items-center gap-2">Preview data
        <select aria-label={route === "/contacts" ? "Preview contact data" : route === "/property-lists" ? "Preview property-list data" : "Preview transaction data"} value={scenario} className="rounded border border-input bg-card px-2 py-1 text-foreground" onChange={event => {
          const url = new URL(window.location.href);
          url.searchParams.set("scenario", event.target.value);
          window.location.assign(url);
        }}>
          <option value="records">Records</option>
          {route === "/contacts" && <option value="empty">Empty contact book</option>}
          {route !== "/property-lists" && <option value="unavailable">First request unavailable</option>}
          {route === "/contacts" && <option value="conflict">Remote change on save (409)</option>}
          {(route === "/contacts" || route === "/property-lists" || interactive) && <option value="interactive">Interactive samples</option>}
        </select>
      </label>}
    </div>
    {interactive && <p role="status" className="border-b border-border bg-card px-4 py-2 text-center text-xs leading-relaxed text-muted-foreground">
      Contact stages, next actions, needs, client information, property lists, CSV import and duplicate merges can save these synthetic samples. Other writes remain blocked. Reload or Reset samples discards every change.
      {(route === "/contacts" || route === "/property-lists") && <span className="ml-1">Property list examples: SAMPLE-002 and SAMPLE-003. Fictional MLS references only.</span>}
    </p>}
    {route === "/contacts" && scenario === "conflict" && <p role="status" className="border-b border-border bg-card px-4 py-2 text-center text-xs leading-relaxed text-muted-foreground">
      Conflict rehearsal: change a sample contact's Company or next action, or review a duplicate merge, then save. The refused save reveals a predefined newer sample version. Review latest details to compare it with your kept draft. No draft is written.
    </p>}
    {writeBlocked && <div role="alert" className="flex items-center justify-center gap-3 border-b border-border bg-card px-4 py-2 text-xs">
      <span>{interactive ? "This write is disabled in interactive samples. Only stages, next actions, needs, client information, property lists, import and duplicate merge can save." : "Design preview is read-only. No records were changed."}</span>
      <button type="button" className="font-semibold underline underline-offset-4" onClick={() => setWriteBlocked(false)}>Dismiss</button>
    </div>}
  </>;
}
function Preview() {
  return <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="fortmark.design-preview.theme"><TooltipProvider delayDuration={250}><PreviewNavigation><PreviewControls /><AppShell user={user} profile={profile}><Content /></AppShell></PreviewNavigation></TooltipProvider></ThemeProvider>;
}
createRoot(document.getElementById("root")).render(<Preview />);

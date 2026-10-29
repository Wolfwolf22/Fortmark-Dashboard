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
import { PreviewNavigation, usePathname } from "./next-stubs";
import { installPreviewTransport } from "./fixtures.mjs";
import { connectLayoutStorage } from "@/lib/stores/layout";
import { pageTitleFor } from "@/components/layout/nav-items";

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
  if (route === "/settings") return <DesignSystem />;
  return <Card className="p-8"><p className="text-micro">Design preview</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">{pageTitleFor(route)}</h2><p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">This preview covers the shared identity and Home layout. This destination is shown to verify navigation, active states and shared styling. Production workflows and records are not connected.</p><Button className="mt-6" onClick={() => window.history.back()}>Go back</Button></Card>;
}

function Preview() {
  return <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="fortmark.design-preview.theme"><TooltipProvider delayDuration={250}><PreviewNavigation><div className="border-b border-border bg-card px-4 py-2 text-center text-xs text-muted-foreground"><span className="font-semibold text-foreground">Design preview</span><span className="mx-2" aria-hidden>·</span>Sample data. No live accounts or services.<a href="/?view=%2Fsettings" className="ml-3 font-semibold text-foreground underline underline-offset-4">View foundations</a></div><AppShell user={user} profile={profile}><Content /></AppShell></PreviewNavigation></TooltipProvider></ThemeProvider>;
}
createRoot(document.getElementById("root")).render(<Preview />);

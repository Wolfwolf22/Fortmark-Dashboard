"use client";
import { Suspense } from "react";
import { CalendarClock } from "lucide-react";
import { PageIntro } from "@/components/common/page-intro";
import { Skeleton } from "@/components/ui/skeleton";
import { ShowingsWorkspace } from "@/components/showings/agenda";
export default function Page() { return <Suspense fallback={<div className="space-y-4"><PageIntro icon={CalendarClock} title="Showing agenda" description="Private showing plans and visit feedback." /><Skeleton className="h-56 w-full rounded-card" /></div>}><ShowingsWorkspace /></Suspense>; }

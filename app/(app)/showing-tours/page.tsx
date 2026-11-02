"use client";
import { Suspense } from "react";
import { MapPinned } from "lucide-react";
import { PageIntro } from "@/components/common/page-intro";
import { Skeleton } from "@/components/ui/skeleton";
import { SavedToursWorkspace } from "@/components/showings/saved-tour-workspace";
export default function Page() { return <Suspense fallback={<div className="space-y-4"><PageIntro title="Saved tours" icon={MapPinned} description="Private tour plans and reviewed showing schedules." /><Skeleton className="h-64 w-full rounded-card" /></div>}><SavedToursWorkspace /></Suspense>; }

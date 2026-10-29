"use client";

import { Suspense } from "react";
import { FolderOpen } from "lucide-react";
import { PageIntro } from "@/components/common/page-intro";
import { PropertyListsWorkspace } from "@/components/property-lists/workspace";
import { Skeleton } from "@/components/ui/skeleton";

export default function Page() {
  return <Suspense fallback={<div className="space-y-4"><PageIntro icon={FolderOpen} title="Property lists" description="Named lists for personal research and client work." /><Skeleton className="h-56 w-full rounded-card" /></div>}><PropertyListsWorkspace /></Suspense>;
}

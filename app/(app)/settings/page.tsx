"use client";

/**
 * Settings — profile, team, brokerage, notifications, and integrations.
 * The active section lives in the URL (?tab=team deep links work from the
 * user menu), so useSearchParams is the source of truth, wrapped in
 * Suspense per the Next 15 requirement.
 */
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrokerageSection } from "@/components/settings/brokerage-section";
import { IntegrationsSection } from "@/components/settings/integrations-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { ProfileSection } from "@/components/settings/profile-section";
import {
  SettingsNav,
  isSettingsTabId,
  type SettingsTabId,
} from "@/components/settings/settings-nav";
import { TeamSection } from "@/components/settings/team-section";
import { Skeleton } from "@/components/ui/skeleton";

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
      <Skeleton className="h-9 w-full max-w-sm rounded-full md:hidden" />
      <div className="hidden w-52 shrink-0 space-y-1 md:block">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-lg" />
        ))}
      </div>
      <div className="min-w-0 max-w-3xl flex-1">
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    </div>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const param = searchParams.get("tab");
  const tab: SettingsTabId = isSettingsTabId(param) ? param : "profile";

  function setTab(next: SettingsTabId) {
    router.replace(`/settings?tab=${next}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
      <SettingsNav tab={tab} onTabChange={setTab} />
      <div className="min-w-0 max-w-3xl flex-1">
        {tab === "profile" && <ProfileSection />}
        {tab === "team" && <TeamSection />}
        {tab === "brokerage" && <BrokerageSection />}
        {tab === "notifications" && <NotificationsSection />}
        {tab === "integrations" && <IntegrationsSection />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsPageInner />
    </Suspense>
  );
}

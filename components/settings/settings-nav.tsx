"use client";

/**
 * Settings section switcher — a vertical mini-nav on desktop, a horizontal
 * Tabs row on small screens. Controlled by the page via ?tab= in the URL.
 */
import { Bell, Building2, Plug, User, Users, type LucideIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const SETTINGS_TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "team", label: "Team", icon: Users },
  { id: "brokerage", label: "Brokerage", icon: Building2 },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "integrations", label: "Integrations", icon: Plug },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export function isSettingsTabId(value: string | null): value is SettingsTabId {
  return SETTINGS_TABS.some((t) => t.id === value);
}

export function SettingsNav({
  tab,
  onTabChange,
}: {
  tab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
}) {
  return (
    <>
      {/* Small screens: horizontal tabs row */}
      <div className="overflow-x-auto pb-1 md:hidden">
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as SettingsTabId)}>
          <TabsList aria-label="Settings sections">
            {SETTINGS_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Desktop: vertical mini-nav */}
      <nav aria-label="Settings sections" className="hidden w-52 shrink-0 md:block">
        <ul className="space-y-1">
          {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onTabChange(id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors duration-150",
                    active
                      ? "bg-tint text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

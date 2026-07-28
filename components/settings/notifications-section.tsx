"use client";

/**
 * Notifications — switch rows persisted to localStorage on this device.
 * Initial render is gated on a mounted flag so stored preferences never
 * cause a hydration mismatch.
 */
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

const STORAGE_KEY = "fm.settings.notifications.v1";

type NotificationKey =
  | "dealMilestones"
  | "documentStatus"
  | "newLeads"
  | "marketDigest"
  | "weeklySummary";

type NotificationPrefs = Record<NotificationKey, boolean>;

const DEFAULTS: NotificationPrefs = {
  dealMilestones: true,
  documentStatus: true,
  newLeads: true,
  marketDigest: true,
  weeklySummary: true,
};

const ROWS: { key: NotificationKey; label: string; description: string }[] = [
  {
    key: "dealMilestones",
    label: "Deal milestones",
    description: "When a transaction reaches or misses a milestone.",
  },
  {
    key: "documentStatus",
    label: "Document status changes",
    description: "When a document is signed, executed, or flagged missing.",
  },
  {
    key: "newLeads",
    label: "New leads",
    description: "When a lead is created or assigned to you.",
  },
  {
    key: "marketDigest",
    label: "Market pulse digest",
    description: "A daily summary of price moves and comps in your markets.",
  },
  {
    key: "weeklySummary",
    label: "Weekly production summary",
    description: "Your team's volume and closings, delivered Monday morning.",
  },
];

function readStored(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const next = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as NotificationKey[]) {
      if (typeof parsed[key] === "boolean") next[key] = parsed[key] as boolean;
    }
    return next;
  } catch {
    return DEFAULTS;
  }
}

export function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULTS);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPrefs(readStored());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Storage unavailable — preferences hold for this visit only.
    }
  }, [prefs, mounted]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Choose what reaches you. Preferences are stored on this device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {mounted ? (
          <div className="divide-y divide-border">
            {ROWS.map(({ key, label, description }) => (
              <div
                key={key}
                className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0"
              >
                <div className="space-y-1">
                  <Label htmlFor={`notify-${key}`}>{label}</Label>
                  <p className="text-[13px] text-muted-foreground">{description}</p>
                </div>
                <Switch
                  id={`notify-${key}`}
                  checked={prefs[key]}
                  onCheckedChange={(checked) =>
                    setPrefs((prev) => ({ ...prev, [key]: checked }))
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {ROWS.map(({ key }) => (
              <Skeleton key={key} className="h-11 w-full" />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

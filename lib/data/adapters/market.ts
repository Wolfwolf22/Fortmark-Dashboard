/**
 * Market pulse + compliance adapter.
 *
 * There is no market feed and no compliance system. Price cuts, new
 * listings and missing-document warnings below are generated, so each read
 * asks first whether this deployment is in the labelled fixture mode.
 */
import { ComplianceItem, MarketActivityItem } from "../types";
import { complianceItems, marketActivity } from "../mock/db";
import { now } from "@/lib/dates";
import { delay } from "./latency";
import { requireSubsystem } from "./subsystems";

export async function getMarketActivity(
  tab: "today" | "history"
): Promise<MarketActivityItem[]> {
  await requireSubsystem("market");
  await delay();
  const startOfToday = new Date(now());
  startOfToday.setHours(0, 0, 0, 0);
  const items = marketActivity.filter((item) =>
    tab === "today"
      ? new Date(item.timestamp) >= startOfToday
      : new Date(item.timestamp) < startOfToday
  );
  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function getComplianceItems(): Promise<ComplianceItem[]> {
  await requireSubsystem("market");
  await delay();
  return [...complianceItems];
}

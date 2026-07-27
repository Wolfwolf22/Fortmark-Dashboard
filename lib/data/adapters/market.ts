/**
 * Market pulse + compliance adapter. Mock-backed today; swap the bodies for
 * the market data feed and the UI is untouched.
 */
import { ComplianceItem, MarketActivityItem } from "../types";
import { complianceItems, marketActivity, now } from "../mock/db";
import { delay } from "./latency";

export async function getMarketActivity(
  tab: "today" | "history"
): Promise<MarketActivityItem[]> {
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
  await delay();
  return [...complianceItems];
}

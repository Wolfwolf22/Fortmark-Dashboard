/**
 * Notifications adapter. Mock-backed today; swap the bodies for the
 * notification service and the UI is untouched.
 */
import { AppNotification } from "../types";
import { notifications } from "../mock/db";
import { bumpDataVersion } from "../store";
import { delay } from "./latency";

export async function getNotifications(): Promise<AppNotification[]> {
  await delay(120);
  return [...notifications].sort((a, b) => b.date.localeCompare(a.date));
}

export async function getUnreadCount(): Promise<number> {
  await delay(60);
  return notifications.filter((n) => !n.read).length;
}

export async function markAllNotificationsRead(): Promise<void> {
  await delay(120);
  let changed = false;
  for (const n of notifications) {
    if (!n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) bumpDataVersion();
}

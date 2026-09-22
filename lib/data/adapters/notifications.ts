/**
 * Notifications adapter.
 *
 * There is no notification service. The alerts below are generated, so each
 * read asks first whether this deployment is in the labelled fixture mode.
 * The bell is the one that reached furthest: certification found it saying
 * "Notifications (3 unread)" on an account with no records at all.
 */
import { AppNotification } from "../types";
import { notifications } from "../mock/db";
import { bumpDataVersion } from "../store";
import { delay } from "./latency";
import { requireSubsystem } from "./subsystems";

export async function getNotifications(): Promise<AppNotification[]> {
  await requireSubsystem("notifications");
  await delay(120);
  return [...notifications].sort((a, b) => b.date.localeCompare(a.date));
}

export async function getUnreadCount(): Promise<number> {
  await requireSubsystem("notifications");
  await delay(60);
  return notifications.filter((n) => !n.read).length;
}

export async function markAllNotificationsRead(): Promise<void> {
  await requireSubsystem("notifications");
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

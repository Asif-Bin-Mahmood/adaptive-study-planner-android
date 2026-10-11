// Android local notifications for study blocks only. The plan (what should be
// scheduled) is computed by domain/notifications.ts; this file executes it.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { diffReminders, planReminders } from '../domain/notifications';
import type { PlanningRules, Session } from '../domain/types';
import type { Repo } from '../data/repo';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export async function notificationPermission(): Promise<PermissionState> {
  if (!Capacitor.isNativePlatform()) return 'unsupported';
  const p = await LocalNotifications.checkPermissions();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!Capacitor.isNativePlatform()) return 'unsupported';
  const p = await LocalNotifications.requestPermissions();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

const CHANNEL = 'study-reminders';

async function ensureChannel() {
  if (Capacitor.getPlatform() !== 'android') return;
  await LocalNotifications.createChannel({
    id: CHANNEL,
    name: 'Study reminders',
    description: 'Reminders before planned study blocks',
    importance: 3,
    visibility: 0,
  });
}

function at(date: string, time: string): Date {
  return new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5));
}

/**
 * Bring the scheduled reminders in line with the current plan: cancel those
 * that are obsolete or changed, schedule new/changed ones. Safe to call often.
 */
export async function syncReminders(repo: Repo, sessions: Session[], rules: PlanningRules): Promise<{ scheduled: number; cancelled: number }> {
  if (!Capacitor.isNativePlatform()) return { scheduled: 0, cancelled: 0 };
  const desired = (await notificationPermission()) === 'granted' ? planReminders(sessions, rules, new Date()) : [];
  const existing = await repo.getReminderMap();
  // also cancel anything pending that our map does not know about
  const pending = await LocalNotifications.getPending();
  for (const p of pending.notifications) if (!existing.has(p.id)) existing.set(p.id, '');
  const diff = diffReminders(existing, desired);
  if (diff.cancel.length) await LocalNotifications.cancel({ notifications: diff.cancel.map((id) => ({ id })) });
  if (diff.schedule.length) {
    await ensureChannel();
    await LocalNotifications.schedule({
      notifications: diff.schedule.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        channelId: CHANNEL,
        schedule: { at: at(r.date, r.time), allowWhileIdle: false },
        // inexact alarms only: never opens the exact-alarm settings screen
        isExactNotification: false,
        extra: { sessionId: r.sessionId },
      })),
    });
  }
  await repo.setReminderMap(desired.map((r) => ({ id: r.id, sessionId: r.sessionId, fingerprint: r.fingerprint })));
  return { scheduled: diff.schedule.length, cancelled: diff.cancel.length };
}

export async function sendTestNotification(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return 'Notifications only work in the Android app.';
  const perm = await notificationPermission();
  if (perm !== 'granted') return 'Notifications are not allowed. Allow them in Android Settings > Apps > Study Planner > Notifications.';
  await ensureChannel();
  await LocalNotifications.schedule({
    notifications: [{ id: 1, title: 'Test reminder', body: 'Study reminders are working.', channelId: CHANNEL, schedule: { at: new Date(Date.now() + 5000) }, isExactNotification: false }],
  });
  return 'A test notification will appear in about 5 seconds.';
}

export async function cancelAllReminders(repo: Repo) {
  if (!Capacitor.isNativePlatform()) return;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  await repo.setReminderMap([]);
}

/**
 * src/services/push.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   notification.service.js already creates a row and pushes it live over
 *   Socket.IO — but that only reaches a tab that's open. Browser push reaches
 *   the user even when Techtrackers isn't open, the way the SLA escalations
 *   and assignments this app is built around actually need to.
 *
 * WHAT IT ACHIEVES
 *   Same shape as mail.service.js: when VAPID keys aren't configured, sends
 *   log to the console instead of failing, so the rest of the app is fully
 *   testable with no external account. Sending is best-effort and never
 *   throws into the caller — same principle as email and the audit log: a
 *   delivery hiccup must never roll back or fail the action that triggered it.
 */
import webpush from 'web-push';
import prisma from '../config/prisma.js';
import env from '../config/env.js';
import logger from '../config/logger.js';

let configured = false;

function ensureConfigured() {
  if (!env.pushEnabled || configured) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
}

export async function subscribe(userId, subscription) {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('Invalid push subscription payload');
  }

  return prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
}

export async function unsubscribe(userId, endpoint) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/** Best-effort fan-out to every device this user has subscribed from. */
export async function sendPushToUser(userId, { title, body, url }) {
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return;

  if (!env.pushEnabled) {
    logger.info(`[PUSH:CONSOLE] To user ${userId} | ${title}: ${body}`);
    return;
  }

  ensureConfigured();
  const payload = JSON.stringify({ title, body, url: url ?? '/' });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          // The browser/OS has discarded this subscription — stop targeting it.
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          logger.error(`Push delivery failed for subscription ${sub.id}: ${error.message}`);
        }
      }
    }),
  );
}

export default { subscribe, unsubscribe, sendPushToUser };

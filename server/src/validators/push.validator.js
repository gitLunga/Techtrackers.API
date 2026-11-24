/**
 * src/validators/push.validator.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The subscribe payload is exactly what the browser's PushManager.subscribe()
 *   promise resolves to (via `.toJSON()`) — validating its shape here keeps
 *   push.service.js from having to guard against malformed input itself.
 */
import { z } from 'zod';

export const subscribeSchema = {
  body: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
};

export const unsubscribeSchema = {
  body: z.object({ endpoint: z.string().url() }),
};

export default { subscribeSchema, unsubscribeSchema };

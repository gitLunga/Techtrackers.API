/**
 * src/config/env.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   ASP.NET gave you IConfiguration + appsettings.json, injected anywhere.
 *   Node's raw equivalent is `process.env`, which is untyped, all-strings, and
 *   silently `undefined` when a key is missing — the classic Node failure is
 *   booting fine and then blowing up at 2am because JWT_ACCESS_SECRET was never
 *   set, so every token was signed with `undefined`.
 *
 * WHAT IT ACHIEVES
 *   Parses and VALIDATES the environment ONCE at startup. If anything required
 *   is missing or malformed the process refuses to boot and prints exactly what
 *   is wrong. Every other file imports this object instead of touching
 *   process.env, so config is centralised and already coerced to real types
 *   (numbers are numbers, lists are arrays, booleans are booleans).
 */
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  SLA_JOB_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SLA_JOB_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Techtrackers <no-reply@techtrackers.local>'),

  // Web Push (browser notifications). Optional, like SMTP above: when unset,
  // push.service.js logs to the console instead of sending, so the rest of
  // the notification flow stays fully testable with no external account.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@techtrackers.local'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail loudly and immediately, before a single request is served.
  console.error('\n Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCopy .env.example to .env and fill in the values.\n');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  // Derived, ready-to-use values so callers never re-parse strings.
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
  mailEnabled: Boolean(parsed.data.SMTP_HOST),
  pushEnabled: Boolean(parsed.data.VAPID_PUBLIC_KEY && parsed.data.VAPID_PRIVATE_KEY),
};

export default env;

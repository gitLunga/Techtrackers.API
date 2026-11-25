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
/* eslint-disable no-console -- This file validates configuration BEFORE the
   logger is constructed, so console is the only output available. Using the
   logger here would be a circular import. */
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

  /**
   * Where ticket attachments are kept.
   *
   *   local  Under UPLOAD_DIR. The default so a fresh clone works with no
   *          cloud account. Correct in production ONLY where the disk really
   *          persists (a VPS, or a mounted volume) — on an ephemeral
   *          container filesystem every attachment is lost on redeploy.
   *   s3     Any S3-compatible bucket. Survives redeploys and works with more
   *          than one instance.
   *
   * See docs/DEPLOYMENT.md. Switching drivers also needs the files you
   * already have moved across: `npm run storage:migrate`.
   */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

  // Only read when STORAGE_DRIVER=s3, and required then — see the refinement
  // below, which fails at boot rather than at the moment a user first tries
  // to attach a file.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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

/**
 * Conditional requirements live here rather than on the individual fields,
 * because what is required depends on another field's value.
 *
 * The point is to fail at BOOT. An S3 driver with no bucket configured would
 * otherwise start cleanly, serve every page correctly, and only break when a
 * user attached their first file — by which time whoever deployed it has gone
 * home.
 */
const withConditionalRules = schema.superRefine((config, ctx) => {
  if (config.STORAGE_DRIVER !== 's3') return;
  for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    if (!config[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when STORAGE_DRIVER=s3`,
      });
    }
  }
});

const parsed = withConditionalRules.safeParse(process.env);

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

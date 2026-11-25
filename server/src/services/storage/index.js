/**
 * src/services/storage/index.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Attachments used to be written straight to a folder next to the app, and
 *   the download endpoint read them back from that same folder. That works on
 *   a laptop and loses data in production.
 *
 *   A container's filesystem is ephemeral. It is discarded on every redeploy,
 *   restart, crash and scale event. So on Render, Heroku, Fly without a
 *   volume, Cloud Run, or anything that runs more than one instance, every
 *   file a user attached to a ticket disappeared the next time the process
 *   restarted — while the row in `log_attachments` survived, so the UI went on
 *   offering a download that 404ed.
 *
 *   Nobody catches it in testing, because a developer redeploys and re-seeds
 *   constantly. It surfaces weeks later, when a technician opens an old ticket
 *   to read the error message somebody screenshotted.
 *
 * WHAT IT ACHIEVES
 *   One narrow interface — save, open, remove, exists — with two drivers
 *   behind it. Nothing above this module knows or cares which is in use:
 *
 *     local  Writes under UPLOAD_DIR. The default, because a developer should
 *            not need cloud credentials to attach a file. Also correct in
 *            production IF the deployment has a real persistent disk (a VPS,
 *            or a mounted volume) — see docs/DEPLOYMENT.md.
 *
 *     s3     Any S3-compatible object store: AWS S3, Cloudflare R2, Backblaze
 *            B2, DigitalOcean Spaces, MinIO. Survives redeploys, needs no
 *            disk, and works with any number of instances.
 *
 *   The key point is that the DRIVER IS A DEPLOYMENT DECISION, not a code
 *   change. Switching is one environment variable plus a one-off migration of
 *   the files you already have (`npm run storage:migrate`).
 *
 * WHY KEYS, NOT PATHS
 *   `log_attachments.storedName` holds an opaque STORAGE KEY, not a filesystem
 *   path. Both drivers interpret the same key, which is what lets you migrate
 *   between them without touching a single database row.
 *
 *   Keys are generated here, never derived from anything the client sent. A
 *   user-supplied name like "../../etc/passwd" must never reach a filesystem
 *   or a bucket.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import env from '../../config/env.js';
import logger from '../../config/logger.js';
import * as localDriver from './local.driver.js';
import * as s3Driver from './s3.driver.js';

const drivers = { local: localDriver, s3: s3Driver };

const driver = drivers[env.STORAGE_DRIVER];
if (!driver) {
  // Unreachable via env.js, which validates the enum — this guards against a
  // driver being added to the enum and not to the map above.
  throw new Error(`Unknown STORAGE_DRIVER "${env.STORAGE_DRIVER}"`);
}

logger.info(`Attachment storage: ${env.STORAGE_DRIVER}${driver.describe ? ` (${driver.describe()})` : ''}`);

/**
 * Builds the key a file will be stored under.
 *
 * Shape: attachments/YYYY/MM/<24 random hex><ext>
 *
 *   - Date-partitioned, because a flat prefix with tens of thousands of
 *     objects is miserable to browse in a bucket console and slow to list.
 *   - Random basename, so the key is unguessable and cannot collide. 12 bytes
 *     of randomness is far beyond what collision avoidance needs.
 *   - Only the extension is carried over from the client's filename, stripped
 *     of anything that is not a word character or a dot. The real filename is
 *     kept in the database (`originalName`) and sent back in
 *     Content-Disposition at download time, so nothing is lost by not
 *     trusting it here.
 */
export function buildKey(originalName, now = new Date()) {
  const ext = path.extname(originalName ?? '').slice(0, 10).replace(/[^.\w]/g, '');
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `attachments/${year}/${month}/${crypto.randomBytes(12).toString('hex')}${ext}`;
}

/**
 * Moves a file multer has already written to a temporary path into permanent
 * storage under `key`, and removes the temporary file.
 *
 * Why a temp file rather than multer's memoryStorage: memory storage holds
 * every byte in RAM, so five concurrent uploads of the maximum size would be
 * five times MAX_UPLOAD_BYTES of heap per request. Streaming from a temp file
 * keeps memory flat and still lets multer enforce the size limit as the bytes
 * arrive.
 */
export const save = (tempPath, key, mimeType) => driver.save(tempPath, key, mimeType);

/** A readable stream of the stored object, for the download endpoint to pipe. */
export const openStream = (key) => driver.openStream(key);

/** Best-effort delete. Used to clean up after a failed ticket creation. */
export const remove = (key) => driver.remove(key);

/** Whether the object is actually there — used by the health check and tests. */
export const exists = (key) => driver.exists(key);

export const activeDriver = env.STORAGE_DRIVER;

export default { buildKey, save, openStream, remove, exists, activeDriver };

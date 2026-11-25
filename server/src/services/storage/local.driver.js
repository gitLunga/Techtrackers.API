/**
 * src/services/storage/local.driver.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The default driver, and the reason a developer can clone this repo and
 *   attach a file to a ticket without signing up for anything.
 *
 *   It is also a legitimate PRODUCTION choice — but only where the deployment
 *   has a genuinely persistent disk: a VPS, or a container with a mounted
 *   volume. On an ephemeral container filesystem it silently loses every
 *   attachment on redeploy, which is the whole reason the storage interface
 *   exists. docs/DEPLOYMENT.md spells out which hosts are which.
 *
 * WHAT IT ACHIEVES
 *   Treats the storage key as a relative path under UPLOAD_DIR, so the same
 *   key works here and in a bucket. Keys contain slashes
 *   (attachments/2026/11/...), so the directory has to be created as the file
 *   is written.
 *
 * PATH TRAVERSAL
 *   Keys are generated in index.js and never come from a client, but this
 *   driver still refuses to resolve outside the upload root. Defence in depth
 *   costs one comparison, and the day someone adds a code path that passes a
 *   key in from outside, this is what stops it writing to /etc.
 */
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';

const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(uploadRoot, { recursive: true });

/** Resolves a key to an absolute path, refusing anything outside the root. */
function resolveKey(key) {
  const full = path.resolve(uploadRoot, key);
  // path.resolve collapses "..", so a key that escapes the root is caught by
  // comparing prefixes afterwards rather than by inspecting the key itself.
  if (full !== uploadRoot && !full.startsWith(uploadRoot + path.sep)) {
    throw ApiError.badRequest('Invalid storage key');
  }
  return full;
}

export const describe = () => uploadRoot;

export async function save(tempPath, key) {
  const target = resolveKey(key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    // A rename is atomic and free when both paths are on the same filesystem,
    // which they are: the temp directory lives inside the upload root for
    // exactly this reason.
    await fsp.rename(tempPath, target);
  } catch (error) {
    // EXDEV means the temp file is on a different device (someone pointed
    // TMPDIR elsewhere). Fall back to a copy, then remove the original.
    if (error.code !== 'EXDEV') throw error;
    await fsp.copyFile(tempPath, target);
    await fsp.unlink(tempPath).catch(() => {});
  }
  return { key };
}

export async function openStream(key) {
  const target = resolveKey(key);
  // Check before streaming so a missing file is a clean 404 from the caller
  // rather than an error event mid-response, after headers have been sent.
  try {
    await fsp.access(target, fs.constants.R_OK);
  } catch {
    throw ApiError.notFound('The stored file for this attachment is missing');
  }
  return fs.createReadStream(target);
}

export async function remove(key) {
  // Already gone is success: this is called to clean up, and the goal state is
  // "not there".
  await fsp.unlink(resolveKey(key)).catch(() => {});
}

export async function exists(key) {
  try {
    await fsp.access(resolveKey(key), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export { uploadRoot };

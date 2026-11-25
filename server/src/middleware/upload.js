/**
 * src/middleware/upload.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old C# API accepted an IFormFile, read it fully into memory, and stored
 *   the raw bytes in the `AttachmentFile` varbinary column — then returned them
 *   as `Convert.ToBase64String(...)` inside EVERY list response. A page of
 *   tickets carrying photos was tens of megabytes of JSON, and the database
 *   grew as a file server.
 *
 * WHAT IT ACHIEVES
 *   Multer streams each upload to a TEMPORARY file and puts only metadata on
 *   `req.files`. The storage layer then moves it to its permanent home — a
 *   local directory or an S3 bucket, decided by configuration — and the
 *   service records the resulting key. List responses stay small and files are
 *   fetched on demand from the download endpoint.
 *
 * WHY A TEMP FILE AND NOT multer.memoryStorage()
 *   Memory storage holds every byte in RAM. Five files at the maximum size, on
 *   a handful of concurrent requests, is heap that scales with traffic and
 *   nothing to show for it. Writing to a temp file keeps memory flat, still
 *   lets multer abort an oversized upload as the bytes arrive, and lets the S3
 *   driver stream from disk rather than buffer.
 *
 *   The temp directory is INSIDE the upload root on purpose: the local driver
 *   finishes the job with a rename, which is atomic and free only when both
 *   paths are on the same filesystem.
 *
 * SECURITY
 *   Two limits an upload endpoint must always have — a maximum size and an
 *   allow-list of content types — plus storage keys that are generated, never
 *   derived from the client's filename. A name like "../../etc/passwd" must
 *   never reach a filesystem or a bucket.
 */
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { buildKey } from '../services/storage/index.js';

// Lives under the upload root so the local driver's rename stays on one
// filesystem. Files here are in flight only: the storage layer removes each
// one as it is committed, whether that succeeds or fails.
const tempRoot = path.resolve(process.cwd(), env.UPLOAD_DIR, '.incoming');
fs.mkdirSync(tempRoot, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tempRoot),
  filename: (_req, file, cb) => {
    // The permanent key is decided here, before a byte is written, and carried
    // on the file object so the service does not have to invent one later.
    // The temp filename is derived from it so a half-finished upload is
    // traceable to the key it was going to take.
    file.storageKey = buildKey(file.originalname);
    cb(null, file.storageKey.replace(/\//g, '_'));
  },
});

export const uploadAttachments = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
}).array('attachments', 5);

/**
 * Multer reports its own limit breaches as MulterError, which would otherwise
 * surface as an opaque 500. Wrapping it converts those into clear 400s.
 */
export const withAttachments = (req, res, next) =>
  uploadAttachments(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(
          ApiError.badRequest(
            `Each file must be ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)}MB or smaller`,
          ),
        );
      }
      if (error.code === 'LIMIT_FILE_COUNT') {
        return next(ApiError.badRequest('A maximum of 5 attachments is allowed'));
      }
      return next(ApiError.badRequest(`Upload failed: ${error.message}`));
    }
    return next(error);
  });

export { tempRoot };
export default withAttachments;

/**
 * src/middleware/upload.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old API accepted an IFormFile, read it fully into memory, and stored the
 *   raw bytes in the `AttachmentFile` varbinary column — then returned them as
 *   `Convert.ToBase64String(...)` inside EVERY list response. A page of tickets
 *   carrying photos was tens of megabytes of JSON, and the database grew as a
 *   file server.
 *
 * WHAT IT ACHIEVES
 *   Multer streams uploads to disk and puts only metadata in `req.files`; the
 *   service records the PATH. List responses stay small, and files are fetched
 *   on demand from a dedicated download endpoint.
 *
 *   It also enforces the two limits an upload endpoint must always have:
 *   a maximum size and an allow-list of content types. Stored filenames are
 *   randomised so a caller cannot control the path on disk (a user-supplied
 *   name like "../../etc/passwd" must never reach the filesystem).
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(uploadRoot, { recursive: true });

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
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    // Never trust the client's filename for the path on disk. Keep only the
    // extension, and generate the rest.
    const ext = path.extname(file.originalname).slice(0, 10).replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
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

export { uploadRoot };
export default withAttachments;

/**
 * src/services/storage/s3.driver.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The driver that makes attachments survive a redeploy. Objects live in a
 *   bucket rather than on the container's disk, so nothing is lost when the
 *   process is replaced, and any number of instances can serve the same files.
 *
 *   It targets the S3 API rather than one vendor, so the same code works with
 *   AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces and MinIO. For a
 *   TUT deployment R2 or B2 are worth a look: both have no egress charge,
 *   which is the line item that surprises people on S3.
 *
 * WHY STREAM THROUGH THE API RATHER THAN REDIRECT TO A PRESIGNED URL
 *   A presigned URL would save this server the bandwidth, and for very large
 *   files it would be the right call. It is deliberately not used here:
 *
 *     - Authorisation stays in one place. getAttachment() already checks that
 *       this user may see this ticket; a presigned URL is a second, parallel
 *       grant that lives on after the check and can be forwarded to anyone.
 *     - A ticket attachment is a screenshot or a short document, capped by
 *       MAX_UPLOAD_BYTES. Proxying a few megabytes is not the bottleneck.
 *     - It keeps both drivers behaving identically, so a test that passes
 *       against local proves the download contract for s3 too.
 *
 *   If attachment sizes ever grow enough to make this the wrong trade, the
 *   change is confined to openStream() and the controller.
 *
 * CREDENTIALS
 *   Never in this file and never in the repo. env.js requires them when
 *   STORAGE_DRIVER=s3 and fails at boot if they are missing, rather than at
 *   the moment a user tries to attach something.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';

let client;

/**
 * Built lazily, so importing this module costs nothing when the local driver
 * is the active one. storage/index.js imports both drivers unconditionally.
 */
function s3() {
  if (client) return client;
  client = new S3Client({
    region: env.S3_REGION,
    // Set for every S3-compatible provider that is not AWS itself. R2, B2,
    // Spaces and MinIO each publish their own endpoint.
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    // AWS and R2 use virtual-hosted-style URLs; MinIO and some self-hosted
    // gateways need path-style. Getting this wrong shows up as NoSuchBucket
    // on a bucket that plainly exists.
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    /**
     * COMPATIBILITY, NOT AN OPTIMISATION. Do not remove this.
     *
     * The SDK's default is WHEN_SUPPORTED, which wraps the request body in
     * `aws-chunked` framing with a trailing CRC32 and replaces Content-Length
     * with x-amz-decoded-content-length. AWS S3 handles that; a good number of
     * S3-compatible services do not, and the symptom is an upload that either
     * fails outright or stores a body with chunk headers embedded in it — a
     * silently corrupted file.
     *
     * WHEN_REQUIRED sends the bytes as-is with a normal Content-Length, which
     * every S3-compatible provider understands.
     *
     * Found by a test against a stub S3 server, which stored the chunk framing
     * as part of the file. That is precisely the corruption a user would have
     * discovered by opening an attachment and finding it broken.
     */
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

export const describe = () =>
  `bucket ${env.S3_BUCKET}${env.S3_ENDPOINT ? ` at ${env.S3_ENDPOINT}` : ` in ${env.S3_REGION}`}`;

export async function save(tempPath, key, mimeType) {
  // ContentLength is passed explicitly because the SDK cannot determine the
  // length of a stream, and without it the request is sent chunked — which
  // some S3-compatible gateways reject outright.
  const { size } = await fsp.stat(tempPath);

  const body = fs.createReadStream(tempPath);

  /**
   * An 'error' event on a stream with no listener is an UNHANDLED ERROR in
   * Node, which terminates the process. That is reachable here: if the PUT
   * fails before the SDK starts reading, the `finally` below unlinks the
   * temp file, and the stream — which opens lazily — then raises ENOENT with
   * nobody listening. One failed upload would take the whole API down.
   *
   * Found by a test that made the PUT fail, which is the only way this path
   * ever runs.
   */
  body.on('error', () => {});

  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: mimeType,
        ContentLength: size,
      }),
    );
  } catch (error) {
    // Stop the stream before the temp file goes, so it cannot open afterwards.
    body.destroy();
    throw error;
  } finally {
    // The temp file goes either way. On failure the caller surfaces the error
    // and the upload is retried by the user; leaving the file behind would
    // slowly fill the disk with nothing useful.
    await fsp.unlink(tempPath).catch(() => {});
  }

  return { key };
}

export async function openStream(key) {
  try {
    const result = await s3().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    // Body is a Node Readable in the Node runtime, which is what the
    // controller pipes to the response.
    return result.Body;
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      throw ApiError.notFound('The stored file for this attachment is missing');
    }
    throw error;
  }
}

export async function remove(key) {
  // S3 treats deleting a missing key as success, which is the behaviour the
  // interface wants.
  await s3()
    .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
    .catch(() => {});
}

export async function exists(key) {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

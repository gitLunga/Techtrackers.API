#!/usr/bin/env node
/**
 * scripts/migrate-attachments.mjs
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Switching STORAGE_DRIVER from local to s3 changes where NEW attachments
 *   go. It does nothing for the ones already on disk — and because
 *   `log_attachments.storedName` holds the same opaque key for both drivers,
 *   those rows would still look perfectly valid while pointing at objects the
 *   bucket has never heard of. Every old attachment would 404.
 *
 *   That is a worse failure than the one being fixed, because it is caused BY
 *   the fix. So the switch is two steps, and this is the second one.
 *
 * WHAT IT ACHIEVES
 *   Copies every file the database knows about from the local upload
 *   directory into the bucket, under the identical key. No database rows are
 *   touched, which is the whole point: keys are driver-agnostic, so once the
 *   objects exist the rows are already correct.
 *
 * HOW TO USE IT
 *   1. Configure the S3 variables in .env but leave STORAGE_DRIVER=local.
 *   2. npm run storage:migrate            (dry run — reports, changes nothing)
 *   3. npm run storage:migrate -- --commit
 *   4. Verify the count it reports, then set STORAGE_DRIVER=s3 and restart.
 *
 *   Doing it in this order means the app keeps serving from disk the whole
 *   time, and the cutover is a restart rather than a window where attachments
 *   are missing.
 *
 * SAFE TO RE-RUN
 *   It skips any object already in the bucket, so an interrupted run can
 *   simply be started again. It never deletes the local file — keep those
 *   until you have confirmed the bucket is serving, then remove them
 *   deliberately.
 */
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import process from 'node:process';
import { PrismaClient } from '@prisma/client';

// Read configuration without going through config/env.js, which would refuse
// to load unless STORAGE_DRIVER is already s3 — the opposite of what this
// script needs, since it runs while the app is still on local.
import 'dotenv/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const commit = process.argv.includes('--commit');
const prisma = new PrismaClient();

const required = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`\n  Missing configuration: ${missing.join(', ')}`);
  console.error('  Set the S3_* variables in .env first (see .env.example).\n');
  process.exit(1);
}

const bucket = process.env.S3_BUCKET;
const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  // Same compatibility setting as the driver — see s3.driver.js for why.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

async function existsInBucket(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('\nAttachment migration: local disk -> S3\n');
  console.log(`  from   ${uploadRoot}`);
  console.log(`  to     bucket ${bucket}${process.env.S3_ENDPOINT ? ` at ${process.env.S3_ENDPOINT}` : ''}`);
  console.log(`  mode   ${commit ? 'COMMIT — objects will be written' : 'DRY RUN — nothing will be written'}\n`);

  const attachments = await prisma.logAttachment.findMany({
    select: { id: true, storedName: true, originalName: true, mimeType: true, sizeBytes: true, logId: true },
    orderBy: { id: 'asc' },
  });

  if (attachments.length === 0) {
    console.log('  No attachments in the database. Nothing to do.\n');
    return { uploaded: 0, skipped: 0, missing: [], failed: [] };
  }

  let uploaded = 0;
  let skipped = 0;
  const missing = [];
  const failed = [];

  for (const attachment of attachments) {
    const key = attachment.storedName;
    const localPath = path.resolve(uploadRoot, key);

    // The case worth reporting loudly: the row exists and the file does not.
    // That is an attachment ALREADY lost — most likely to an earlier redeploy
    // on an ephemeral filesystem, which is the very bug being closed here.
    if (!fs.existsSync(localPath)) {
      missing.push(attachment);
      continue;
    }

    if (await existsInBucket(key)) {
      skipped += 1;
      continue;
    }

    if (!commit) {
      uploaded += 1;
      continue;
    }

    try {
      const { size } = await fsp.stat(localPath);
      const body = fs.createReadStream(localPath);
      body.on('error', () => {});
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: attachment.mimeType,
          ContentLength: size,
        }),
      );
      uploaded += 1;
      if (uploaded % 25 === 0) console.log(`  ... ${uploaded} uploaded`);
    } catch (error) {
      failed.push({ attachment, message: error.message });
    }
  }

  console.log('');
  console.log(`  ${commit ? 'uploaded' : 'would upload'}   ${uploaded}`);
  console.log(`  already there      ${skipped}`);
  console.log(`  missing locally    ${missing.length}`);
  console.log(`  failed             ${failed.length}`);

  if (missing.length > 0) {
    console.log('\n  MISSING FILES — these rows reference a file that is not on disk.');
    console.log('  They were almost certainly lost to an earlier redeploy on an');
    console.log('  ephemeral filesystem, which is the bug this storage change closes.');
    console.log('  Nothing here can recover them; they are listed so you know which');
    console.log('  tickets have a download that will 404:\n');
    for (const a of missing.slice(0, 20)) {
      console.log(`    attachment ${a.id} on ticket ${a.logId}: ${a.originalName} (${a.storedName})`);
    }
    if (missing.length > 20) console.log(`    ... and ${missing.length - 20} more`);
  }

  if (failed.length > 0) {
    console.log('\n  FAILED UPLOADS — re-run to retry these:\n');
    for (const f of failed.slice(0, 20)) {
      console.log(`    attachment ${f.attachment.id}: ${f.message}`);
    }
  }

  if (!commit && uploaded > 0) {
    console.log('\n  This was a dry run. Re-run with --commit to upload:');
    console.log('      npm run storage:migrate -- --commit\n');
  } else if (commit && failed.length === 0) {
    console.log('\n  Done. Now set STORAGE_DRIVER=s3 and restart the API.');
    console.log('  Keep the local files until you have confirmed downloads work.\n');
  }

  return { uploaded, skipped, missing, failed };
}

main()
  .then((result) => {
    // A non-zero exit on failure so a deployment script notices.
    process.exit(result.failed.length > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('\n  Migration failed:', error.message, '\n');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

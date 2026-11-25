/**
 * tests/unit/storage.test.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Attachment storage is where the system was quietly losing user data, so
 *   the fix needs tests that would notice it coming back.
 *
 *   Two separate things are checked here, and they fail for different reasons:
 *
 *     1. KEY GENERATION — keys must never be derived from a client's filename,
 *        must not collide, and must be date-partitioned. A regression here is
 *        a path-traversal or a collision, both silent.
 *
 *     2. THE S3 DRIVER AGAINST A REAL HTTP CONVERSATION — the driver's risk is
 *        not its logic but whether it drives the AWS SDK correctly. Mocking the
 *        SDK would only assert that we call the function we already believe we
 *        should call, which is the thing in doubt. So it talks to a small
 *        S3-compatible server (tests/integration/s3-stub.js) over real HTTP.
 *
 *   The local driver is covered end to end by the integration suite, which
 *   uploads and downloads through the running app.
 *
 * WHY THIS IS A UNIT TEST DESPITE OPENING A SOCKET
 *   It needs no database and no migrations, runs in well under a second, and
 *   should run on every save. A loopback HTTP server is cheaper than the
 *   Prisma client the integration project spins up.
 */
import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { startS3Stub } from '../integration/s3-stub.js';

/**
 * ORDER MATTERS HERE, and getting it wrong is silent.
 *
 * config/env.js validates process.env ONCE, at import, and freezes the result
 * as a module singleton. So the S3 settings have to be in place before
 * anything that imports env.js is loaded — which is every module under test.
 * Setting them in beforeAll() is too late: the driver would already hold an
 * env with no bucket, and every call would fail with "No value provided for
 * input HTTP label: Bucket".
 *
 * Hence the stub is started and the variables are set at module scope, and
 * the modules under test are pulled in afterwards with dynamic import.
 */
const stub = await startS3Stub();

process.env.STORAGE_DRIVER = 's3';
process.env.S3_BUCKET = stub.bucket;
process.env.S3_ENDPOINT = stub.endpoint;
process.env.S3_REGION = 'us-east-1';
process.env.S3_ACCESS_KEY_ID = 'test-key-id';
process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.S3_FORCE_PATH_STYLE = 'true';

const { buildKey } = await import('../../src/services/storage/index.js');
const driver = await import('../../src/services/storage/s3.driver.js');

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-storage-'));

afterAll(async () => {
  await stub.stop();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('buildKey — keys are generated, never taken from the client', () => {
  it('keeps only the extension from the original filename', () => {
    const key = buildKey('Screenshot of the broken projector.PNG');
    expect(key).toMatch(/\.PNG$/);
    // The human name is kept in the database and returned in
    // Content-Disposition; it has no business in the key.
    expect(key).not.toMatch(/Screenshot/i);
    expect(key).not.toMatch(/broken/i);
  });

  it('is date-partitioned so a bucket stays browsable', () => {
    const key = buildKey('photo.jpg', new Date('2026-03-07T00:00:00Z'));
    expect(key).toMatch(/^attachments\/2026\/03\//);
  });

  it('pads the month, so sorting a listing is chronological', () => {
    expect(buildKey('a.jpg', new Date('2026-01-15T00:00:00Z'))).toContain('/2026/01/');
    expect(buildKey('a.jpg', new Date('2026-12-15T00:00:00Z'))).toContain('/2026/12/');
  });

  /**
   * The reason the key is not the filename. Every one of these is a real
   * attempt to write outside the storage root, and all of them must come out
   * as an inert extension or nothing at all.
   */
  it.each([
    '../../etc/passwd',
    '../../../root/.ssh/authorized_keys',
    '..\\..\\windows\\system32\\config',
    '/absolute/path/file.txt',
    'file.txt/../../escape.txt',
    'nul\u0000.txt',
    'a'.repeat(5000) + '.jpg',
  ])('neutralises a hostile filename: %s', (hostile) => {
    const key = buildKey(hostile);
    expect(key).toMatch(/^attachments\/\d{4}\/\d{2}\/[0-9a-f]{24}/);
    // The decisive assertion: nothing in the key can climb out of the prefix.
    expect(key).not.toContain('..');
    expect(path.posix.normalize(key).startsWith('attachments/')).toBe(true);
  });

  it('does not collide across many keys', () => {
    // 12 random bytes is far beyond what collision avoidance needs; this
    // guards against someone replacing it with a timestamp or a counter.
    const keys = new Set(Array.from({ length: 5000 }, () => buildKey('x.png')));
    expect(keys.size).toBe(5000);
  });

  it('copes with a filename that has no extension at all', () => {
    const key = buildKey('README');
    expect(key).toMatch(/^attachments\/\d{4}\/\d{2}\/[0-9a-f]{24}$/);
  });

  it('copes with a missing filename rather than throwing', () => {
    // Defensive: multer always supplies one, but a future caller might not.
    expect(() => buildKey(undefined)).not.toThrow();
    expect(() => buildKey(null)).not.toThrow();
  });
});

describe('the s3 driver, against a real S3-compatible server', () => {
  /** Writes a temp file the way multer would, and returns its path. */
  async function stageFile(name, contents) {
    const p = path.join(tmpDir, name);
    await fs.writeFile(p, contents);
    return p;
  }

  it('uploads a file and removes the temporary copy', async () => {
    const temp = await stageFile('upload.txt', 'projector will not power on');
    const key = 'attachments/2026/11/aaaabbbbccccddddeeeeffff.txt';

    await driver.save(temp, key, 'text/plain');

    expect(stub.objects.get(key).body.toString()).toBe('projector will not power on');
    // The temp file must be gone, or the disk fills with copies of every
    // upload the service ever handled.
    await expect(fs.access(temp)).rejects.toThrow();
  });

  it('sends an explicit Content-Length rather than chunking', async () => {
    // The reason save() stats the file first. Without ContentLength the SDK
    // sends the stream chunked, and several S3-compatible gateways reject
    // that outright — a failure that only appears against a real provider.
    const body = 'x'.repeat(1234);
    const temp = await stageFile('sized.txt', body);
    const key = 'attachments/2026/11/111122223333444455556666.txt';

    await driver.save(temp, key, 'text/plain');

    const put = stub.requests.find((r) => r.method === 'PUT' && r.key === key);
    expect(put.contentLength).toBe(String(1234));
    expect(put.transferEncoding).toBeUndefined();
  });

  it('preserves the content type, so a download is not served as octet-stream', async () => {
    const temp = await stageFile('image.png', 'not-really-a-png');
    const key = 'attachments/2026/11/777788889999aaaabbbbcccc.png';

    await driver.save(temp, key, 'image/png');

    expect(stub.objects.get(key).contentType).toBe('image/png');
  });

  it('streams a stored object back byte for byte', async () => {
    const contents = 'line one\nline two\nline three\n';
    const temp = await stageFile('read.txt', contents);
    const key = 'attachments/2026/11/ddddeeeeffff000011112222.txt';
    await driver.save(temp, key, 'text/plain');

    const stream = await driver.openStream(key);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(Buffer.concat(chunks).toString()).toBe(contents);
  });

  it('reports a missing object as a 404, not a 500', async () => {
    // The distinction that matters to the download endpoint: an attachment
    // row whose object is gone is "not found", not "the server is broken".
    await expect(driver.openStream('attachments/2026/11/nothinghereatall000000.txt'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('deletes an object', async () => {
    const temp = await stageFile('delete-me.txt', 'temporary');
    const key = 'attachments/2026/11/33334444555566667777888f.txt';
    await driver.save(temp, key, 'text/plain');
    expect(await driver.exists(key)).toBe(true);

    await driver.remove(key);

    expect(await driver.exists(key)).toBe(false);
  });

  it('treats deleting an absent object as success', async () => {
    // remove() is the cleanup path for a failed ticket creation. It runs when
    // something has already gone wrong, so it must not add an error of its
    // own — the goal state is "not there", and it already is.
    await expect(driver.remove('attachments/2026/11/neverexisted0000000000.txt')).resolves.not.toThrow();
  });

  it('reports exists() as false for a missing object instead of throwing', async () => {
    expect(await driver.exists('attachments/2026/11/absent00000000000000000.txt')).toBe(false);
  });
});

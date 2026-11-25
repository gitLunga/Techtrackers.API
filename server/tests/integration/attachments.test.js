/**
 * tests/integration/attachments.test.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Attachments had two independent faults, and each was invisible in a way
 *   the other was not:
 *
 *     1. Files were written to the container's own disk, so every one of them
 *        vanished on redeploy while the database row survived — a download
 *        that 404s on a ticket that still lists the file.
 *
 *     2. The download endpoint sits behind `authenticate`, which reads the
 *        token from the Authorization header, but the UI opened it as a plain
 *        <a href>. A browser navigation carries no such header, so attachment
 *        download returned 401 every single time and never worked at all.
 *
 *   Neither shows up in a unit test. The first needs a real request writing a
 *   real file; the second needs the actual middleware chain. So this file
 *   drives the whole route through supertest against a real database.
 *
 * WHAT IT PINS
 *   The round trip — a file goes in through the create endpoint and comes back
 *   out of the download endpoint byte for byte — plus the authorisation and
 *   validation rules around it, and the behaviour when the stored object is
 *   gone.
 *
 * SCOPE
 *   Runs against whichever driver is configured, which in CI and locally is
 *   `local`. The S3 driver is covered separately in tests/unit/storage.test.js
 *   against a stub S3 server, because the risk there is SDK usage rather than
 *   route wiring. Between them both drivers are exercised.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { app, api, auth, request, prisma, seedBaseline, loginAll } from './fixtures.js';
import { truncateAll } from './setup.js';
import * as storage from '../../src/services/storage/index.js';

let world;
let tokens;

const FILE = Buffer.from('a screenshot of the broken projector, pretend this is a PNG');

beforeAll(async () => {
  await truncateAll();
  world = await seedBaseline();
  tokens = await loginAll(world.users);
});

/** Logs a ticket with one attachment and returns the created body. */
async function logTicketWithFile(token, filename = 'projector.png', contents = FILE) {
  const res = await request(app)
    .post(api('/logs'))
    .set(auth(token))
    .field('title', 'Projector in Lecture Hall 3 will not power on')
    .field('description', 'No lights on the unit. Screenshot of the error attached.')
    .field('categoryId', String(world.category.id))
    .field('priority', 'HIGH')
    .attach('attachments', contents, filename);
  return res;
}

describe('attachment round trip', () => {
  let ticket;
  let attachment;

  it('accepts a file when a ticket is logged', async () => {
    const res = await logTicketWithFile(tokens.staff);
    expect(res.status).toBe(201);

    ticket = res.body.data;
    expect(ticket.attachments).toHaveLength(1);

    [attachment] = ticket.attachments;
    expect(attachment.originalName).toBe('projector.png');
    expect(attachment.sizeBytes).toBe(FILE.length);
  });

  it('never returns the file contents in the ticket JSON', async () => {
    // The whole reason the old design was replaced: the C# API base64-inlined
    // every attachment into every list response, so a page of tickets with
    // photos was tens of megabytes.
    const serialised = JSON.stringify(ticket);
    expect(serialised).not.toContain(FILE.toString('base64'));
    expect(serialised).not.toContain('a screenshot of the broken projector');
    // The storage key is an internal detail and is not exposed either.
    expect(attachment.storedName).toBeUndefined();
  });

  it('stores it under a generated key, not the name the user sent', async () => {
    const row = await prisma.logAttachment.findUnique({ where: { id: attachment.id } });

    // A client-supplied name must never decide where a file lands.
    expect(row.storedName).not.toContain('projector');
    expect(row.storedName).toMatch(/^attachments\/\d{4}\/\d{2}\/[0-9a-f]{24}\.png$/);
    // The human name survives in the database, for the download filename.
    expect(row.originalName).toBe('projector.png');
  });

  it('actually put the object where the row says it is', async () => {
    // The assertion the ephemeral-disk bug would have failed. A row pointing
    // at an object that is not there is exactly the broken state being fixed.
    const row = await prisma.logAttachment.findUnique({ where: { id: attachment.id } });
    expect(await storage.exists(row.storedName)).toBe(true);
  });

  it('downloads it back byte for byte', async () => {
    const res = await request(app)
      .get(api(`/logs/${ticket.id}/attachments/${attachment.id}`))
      .set(auth(tokens.staff))
      .buffer()
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.body.equals(FILE)).toBe(true);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['content-length']).toBe(String(FILE.length));
    // The real filename, not the storage key.
    expect(res.headers['content-disposition']).toContain('projector.png');
  });

  it('leaves no temporary file behind', async () => {
    // The temp directory is where multer stages uploads before the storage
    // layer commits them. Anything left there is a slow disk leak.
    const { tempRoot } = await import('../../src/middleware/upload.js');
    const { readdir } = await import('node:fs/promises');
    const leftovers = await readdir(tempRoot).catch(() => []);
    expect(leftovers).toEqual([]);
  });
});

describe('downloading an attachment is authorised like the ticket itself', () => {
  let ticket;
  let attachment;

  beforeAll(async () => {
    const res = await logTicketWithFile(tokens.staff, 'private-note.pdf');
    ticket = res.body.data;
    [attachment] = ticket.attachments;
  });

  it('refuses a request with no token at all', async () => {
    // THE REGRESSION TEST for the second fault. The UI used to open this URL
    // as a plain link, which sends no Authorization header, so every download
    // 401ed. The endpoint is right to refuse — the client was wrong — and this
    // pins that the endpoint stays closed.
    const res = await request(app).get(api(`/logs/${ticket.id}/attachments/${attachment.id}`));
    expect(res.status).toBe(401);
  });

  it('serves it to the reporter', async () => {
    const res = await request(app)
      .get(api(`/logs/${ticket.id}/attachments/${attachment.id}`))
      .set(auth(tokens.staff));
    expect(res.status).toBe(200);
  });

  it('serves it to an admin', async () => {
    const res = await request(app)
      .get(api(`/logs/${ticket.id}/attachments/${attachment.id}`))
      .set(auth(tokens.admin));
    expect(res.status).toBe(200);
  });

  it("hides it from a staff member in another department", async () => {
    // An attachment is as confidential as the ticket carrying it. 404 rather
    // than 403, for the same reason the ticket itself answers 404: confirming
    // existence is a disclosure.
    const res = await request(app)
      .get(api(`/logs/${ticket.id}/attachments/${attachment.id}`))
      .set(auth(tokens.otherStaff));
    expect(res.status).toBe(404);
  });

  it('refuses an attachment id that belongs to a different ticket', async () => {
    // The id pair must be checked together. Looking the attachment up by id
    // alone would let anyone who can see ANY ticket read every attachment in
    // the system.
    const other = await logTicketWithFile(tokens.otherStaff, 'other-department.pdf');
    const foreignAttachment = other.body.data.attachments[0].id;

    const res = await request(app)
      .get(api(`/logs/${ticket.id}/attachments/${foreignAttachment}`))
      .set(auth(tokens.staff));
    expect(res.status).toBe(404);
  });
});

describe('when the stored object is missing', () => {
  it('answers 404 rather than a broken 200', async () => {
    // What every attachment uploaded before this fix looks like if it was
    // lost to a redeploy. The important part is that it is a clean error:
    // setting headers first and discovering the object is gone mid-stream
    // would give a 200 with a truncated body, which a browser reports as a
    // corrupt file.
    const res = await logTicketWithFile(tokens.staff, 'will-vanish.png');
    const { id: logId, attachments } = res.body.data;

    await prisma.logAttachment.update({
      where: { id: attachments[0].id },
      data: { storedName: 'attachments/2026/01/deadbeefdeadbeefdeadbeef.png' },
    });

    const download = await request(app)
      .get(api(`/logs/${logId}/attachments/${attachments[0].id}`))
      .set(auth(tokens.staff));

    expect(download.status).toBe(404);
    expect(download.body.success).toBe(false);
  });
});

describe('upload limits still apply', () => {
  it('rejects a file type that is not on the allow-list', async () => {
    const res = await request(app)
      .post(api('/logs'))
      .set(auth(tokens.staff))
      .field('title', 'Trying to attach an executable to a ticket')
      .field('description', 'This should be refused before anything is stored.')
      .field('categoryId', String(world.category.id))
      .field('priority', 'LOW')
      .attach('attachments', Buffer.from('MZ\x90\x00'), {
        filename: 'payload.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unsupported file type/i);
  });

  it('logs a ticket fine with no attachment at all', async () => {
    const res = await request(app)
      .post(api('/logs'))
      .set(auth(tokens.staff))
      .field('title', 'A fault reported with no attachment whatsoever')
      .field('description', 'Attachments are optional and must stay optional.')
      .field('categoryId', String(world.category.id))
      .field('priority', 'LOW');

    expect(res.status).toBe(201);
    expect(res.body.data.attachments).toEqual([]);
  });
});

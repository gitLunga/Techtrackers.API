/**
 * tests/integration/s3-stub.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The S3 driver's risk is not its logic — it is whether it drives the AWS
 *   SDK correctly. Does PutObject get a ContentLength when the body is a
 *   stream? Does path-style addressing resolve? Does a missing key come back
 *   as something the driver recognises as a 404 rather than a 500?
 *
 *   None of that is provable by mocking the SDK, because mocking the SDK
 *   asserts that we called the function we think we should call — which is
 *   the very thing in doubt. It needs a real HTTP conversation.
 *
 *   MinIO in Docker would be the usual answer. There is no Docker daemon in
 *   this environment, and requiring one would also mean the test could not
 *   run in CI without extra services. So this is a small S3-compatible server
 *   instead: enough of the protocol for the four operations the driver uses,
 *   speaking real HTTP, holding objects in memory.
 *
 * WHAT IT IS NOT
 *   Not an S3 implementation. No auth checking, no multipart, no versioning,
 *   no listing. It proves the driver's SDK usage is correct against something
 *   that behaves like S3 on the wire; it does not prove AWS itself behaves
 *   this way. Those are different claims and only the first is testable here.
 */
import http from 'node:http';

/** The XML shape the SDK parses to decide an error is NoSuchKey. */
const noSuchKey = (key) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code>` +
  `<Message>The specified key does not exist.</Message><Key>${key}</Key></Error>`;

/**
 * Starts the stub and resolves with the endpoint, the backing store (so a
 * test can assert on what actually landed) and a stop function.
 */
export async function startS3Stub({ bucket = 'test-bucket' } = {}) {
  /** key -> { body: Buffer, contentType: string, contentLength: number } */
  const objects = new Map();
  /** Every request seen, so a test can assert on headers the SDK sent. */
  const requests = [];

  const server = http.createServer((req, res) => {
    // Path-style addressing: /<bucket>/<key...>
    const url = new URL(req.url, 'http://localhost');
    const segments = url.pathname.replace(/^\//, '').split('/');
    const reqBucket = segments.shift();
    const key = decodeURIComponent(segments.join('/'));

    requests.push({
      method: req.method,
      bucket: reqBucket,
      key,
      contentLength: req.headers['content-length'],
      contentType: req.headers['content-type'],
      transferEncoding: req.headers['transfer-encoding'],
    });

    if (reqBucket !== bucket) {
      res.writeHead(404, { 'Content-Type': 'application/xml' });
      return res.end('<Error><Code>NoSuchBucket</Code></Error>');
    }

    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        objects.set(key, {
          body: Buffer.concat(chunks),
          contentType: req.headers['content-type'],
          contentLength: Number(req.headers['content-length'] ?? 0),
        });
        res.writeHead(200, { ETag: '"stub"' });
        res.end();
      });
      return undefined;
    }

    if (req.method === 'GET') {
      const object = objects.get(key);
      if (!object) {
        res.writeHead(404, { 'Content-Type': 'application/xml' });
        return res.end(noSuchKey(key));
      }
      res.writeHead(200, {
        'Content-Type': object.contentType ?? 'application/octet-stream',
        'Content-Length': object.body.length,
      });
      return res.end(object.body);
    }

    if (req.method === 'HEAD') {
      const object = objects.get(key);
      if (!object) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Length': object.body.length });
      return res.end();
    }

    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }

    res.writeHead(405);
    return res.end();
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  return {
    endpoint: `http://127.0.0.1:${port}`,
    bucket,
    objects,
    requests,
    stop: () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  };
}

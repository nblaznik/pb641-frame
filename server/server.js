const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

function imageRevision(image) {
  return crypto.createHash('sha256').update(image).digest('hex');
}

function suppliedToken(request, url) {
  const authorization = request.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice(7);
  }
  return url.searchParams.get('token') || '';
}

function tokenMatches(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    ...headers,
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        reject(Object.assign(new Error('Image is too large'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function createServer({ token, dataDirectory }) {
  if (!token) {
    throw new Error('FRAME_TOKEN must be set');
  }

  fs.mkdirSync(dataDirectory, { recursive: true });
  const imagePath = path.join(dataDirectory, 'latest.jpg');
  let image = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;
  let revision = image ? imageRevision(image) : null;

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      send(response, 200, INDEX_HTML, { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }

    if (!tokenMatches(suppliedToken(request, url), token)) {
      send(response, 401, Buffer.from('Unauthorized\n'), {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/revision') {
      if (!revision) {
        send(response, 204, Buffer.alloc(0));
        return;
      }
      send(response, 200, Buffer.from(`${revision}\n`), {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/image') {
      if (!image) {
        send(response, 404, Buffer.from('No drawing has been sent\n'));
        return;
      }
      send(response, 200, image, {
        'Content-Type': 'image/jpeg',
        ETag: `"${revision}"`,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/image') {
      if (request.headers['content-type'] !== 'image/jpeg') {
        send(response, 415, Buffer.from('Expected image/jpeg\n'));
        return;
      }

      try {
        const uploaded = await readBody(request);
        const isJpeg = uploaded.length >= 4 && uploaded[0] === 0xff && uploaded[1] === 0xd8 &&
          uploaded[uploaded.length - 2] === 0xff && uploaded[uploaded.length - 1] === 0xd9;
        if (!isJpeg) {
          send(response, 400, Buffer.from('Invalid JPEG\n'));
          return;
        }

        const nextRevision = imageRevision(uploaded);
        const changed = nextRevision !== revision;
        if (changed) {
          const temporaryPath = `${imagePath}.${process.pid}.tmp`;
          fs.writeFileSync(temporaryPath, uploaded, { mode: 0o600 });
          fs.renameSync(temporaryPath, imagePath);
          image = uploaded;
          revision = nextRevision;
        }

        const result = Buffer.from(JSON.stringify({ revision: nextRevision, changed }));
        send(response, changed ? 201 : 200, result, {
          'Content-Type': 'application/json; charset=utf-8',
        });
      } catch (error) {
        if (!response.headersSent) {
          send(response, error.status || 500, Buffer.from(`${error.message}\n`));
        }
      }
      return;
    }

    send(response, 404, Buffer.from('Not found\n'));
  });
}

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || '8080', 10);
  const server = createServer({
    token: process.env.FRAME_TOKEN,
    dataDirectory: process.env.DATA_DIR || path.join(__dirname, 'data'),
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`PocketBook Frame server listening on port ${port}`);
  });
}

module.exports = { createServer };

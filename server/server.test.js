const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createServer } = require('./server');

test('stores and serves a private drawing', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pb641-frame-'));
  const server = createServer({ token: 'secret-token', dataDirectory });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.close();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);

  assert.equal((await fetch(`${baseUrl}/api/revision`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/revision?token=secret-token`)).status, 204);

  const upload = await fetch(`${baseUrl}/api/image`, {
    method: 'POST',
    headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'image/jpeg' },
    body: jpeg,
  });
  assert.equal(upload.status, 201);
  assert.equal((await upload.json()).changed, true);

  const revision = await (await fetch(`${baseUrl}/api/revision?token=secret-token`)).text();
  assert.match(revision, /^[a-f0-9]{64}\n$/);
  const downloaded = await (await fetch(`${baseUrl}/api/image?token=secret-token`)).arrayBuffer();
  assert.deepEqual(Buffer.from(downloaded), jpeg);

  const duplicate = await fetch(`${baseUrl}/api/image`, {
    method: 'POST',
    headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'image/jpeg' },
    body: jpeg,
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).changed, false);
});
